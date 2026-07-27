(function initialiseBlurContent() {
  "use strict";

  const MEDIA_SELECTOR = BlurMediaLifecycle.MEDIA_SELECTOR;
  const BACKGROUND_CANDIDATE_SELECTOR = [
    '[role="img"]',
    '[style*="background" i]',
    '[class*="background" i]',
    '[class*="image" i]',
    '[class*="photo" i]',
    '[class*="avatar" i]',
    '[class*="thumbnail" i]',
    '[class*="poster" i]',
    '[class*="hero" i]'
  ].join(", ");
  const SECTION_CONTROL_SELECTOR = "input, textarea, select, button";
  const EXCLUDED_TEXT_PARENTS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TITLE", "TEXTAREA", "INPUT", "SELECT", "OPTION", "BUTTON"
  ]);
  const MANAGED_TARGET_CLASS = "blur-extension-target";
  const BACKGROUND_TARGET_CLASS = "blur-extension-background-target";
  const SECTION_CLASS = "blur-extension-section";
  const TEXT_FRAGMENT_CLASS = "blur-extension-text-fragment";
  const PII_FRAGMENT_CLASS = BlurPiiDom.FRAGMENT_CLASS;
  const REVEALED_CLASS = "blur-extension-revealed";
  const PICKER_CLASS = "blur-extension-picker-candidate";

  let state = BlurCore.createDefaultState();
  let profiles = [];
  let scanPlan = BlurScanPlan.create();
  let observer;
  let picker;
  let revealControl;
  let pageFeaturesActive = false;
  let pageFeatureController;
  let piiRefreshTimer;
  let pendingRoots = new Set();
  let applyFrame;
  let currentDocumentUrl = location.href;
  const registry = BlurModel.createRegistry();
  const trackedPiiFields = new Set();
  let revealedTargets = new WeakSet();
  let revealedSections = new WeakSet();

  initialise().catch(reportError);

  async function initialise() {
    const stored = await chrome.storage.local.get(BlurCore.STORAGE_KEY);
    state = BlurCore.normaliseState(stored[BlurCore.STORAGE_KEY]);
    setProfiles(BlurCore.matchingProfiles(state, location.href));

    syncPageFeatures();
    reportStatus();

    chrome.storage.onChanged.addListener(handleStorageChange);
    chrome.runtime.onMessage.addListener(handleMessage);
    window.addEventListener("popstate", refreshProfilesForCurrentUrl);
    window.addEventListener("hashchange", refreshProfilesForCurrentUrl);
    window.navigation?.addEventListener("navigatesuccess", refreshProfilesForCurrentUrl);
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== "local" || !changes[BlurCore.STORAGE_KEY]) return;
    state = BlurCore.normaliseState(changes[BlurCore.STORAGE_KEY].newValue);
    setProfiles(BlurCore.matchingProfiles(state, location.href));
    const transitioned = syncPageFeatures();
    if (pageFeaturesActive && !transitioned) reapplyAll();
    reportStatus();
  }

  function handleMessage(message, _sender, sendResponse) {
    if (message?.type === "START_PICKER") {
      startPicker(message.profileId, message.kind);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "GET_PAGE_STATUS") {
      sendResponse({ ok: true, profileCount: profiles.length });
    }
  }

  function observePage() {
    observer = new MutationObserver((mutations) => {
      if (refreshProfilesForCurrentUrl()) return;

      const mediaTargets = BlurMediaLifecycle.collectImmediateMediaTargets(mutations);
      const changedRoots = BlurMediaLifecycle.collectDeferredRoots(mutations);
      if (mediaTargets.size || changedRoots.size) {
        withObserverPaused(() => {
          guardNativeMediaTargets(mediaTargets);
          guardPiiRoots(changedRoots);
          guardConditionalSections(changedRoots);
        });
      }

      changedRoots.forEach((root) => pendingRoots.add(root));
      scheduleApply();
    });
    observer.observe(document, currentObserverOptions());
  }

  function syncPageFeatures() {
    const shouldBeActive = profiles.length > 0;
    if (shouldBeActive === pageFeaturesActive) return false;
    if (shouldBeActive) activatePageFeatures();
    else deactivatePageFeatures();
    return true;
  }

  function activatePageFeatures() {
    pageFeaturesActive = true;
    pageFeatureController = new AbortController();
    const signal = pageFeatureController.signal;
    applyProfiles(document);
    observePage();
    createRevealControl();
    configurePiiRefresh();
    document.addEventListener("pointerover", handleMediaPointerOver, { capture: true, signal });
    document.addEventListener("pointerout", handleMediaPointerOut, { capture: true, signal });
    document.addEventListener("input", handleSensitiveFieldInput, { capture: true, signal });
    document.addEventListener("keydown", handleRevealKeydown, { capture: true, signal });
    document.addEventListener("visibilitychange", refreshPiiFields, { signal });
    window.addEventListener("load", reapplyAll, { once: true, signal });
  }

  function deactivatePageFeatures() {
    pageFeaturesActive = false;
    pageFeatureController?.abort();
    pageFeatureController = undefined;
    observer?.disconnect();
    observer = undefined;
    clearInterval(piiRefreshTimer);
    piiRefreshTimer = undefined;
    if (applyFrame) cancelAnimationFrame(applyFrame);
    applyFrame = undefined;
    pendingRoots.clear();
    trackedPiiFields.clear();
    hideRevealButton();
    revealControl?.host.remove();
    revealControl = undefined;
    resetRevealState();
    clearManagedEffects();
  }

  function refreshProfilesForCurrentUrl() {
    if (location.href === currentDocumentUrl) return false;
    currentDocumentUrl = location.href;
    setProfiles(BlurCore.matchingProfiles(state, currentDocumentUrl));
    const transitioned = syncPageFeatures();
    if (pageFeaturesActive && !transitioned) reapplyAll();
    reportStatus();
    return true;
  }

  function scheduleApply() {
    if (applyFrame || !pendingRoots.size) return;
    applyFrame = requestAnimationFrame(() => {
      applyFrame = undefined;
      const roots = BlurMediaLifecycle.collapseRoots(pendingRoots);
      pendingRoots = new Set();
      withObserverPaused(() => roots.forEach((root) => applyProfiles(root, {
        skipPii: true,
        skipConditional: true,
        skipNativeMedia: true
      })));
    });
  }

  function reapplyAll() {
    if (!pageFeaturesActive) return;
    if (applyFrame) cancelAnimationFrame(applyFrame);
    applyFrame = undefined;
    pendingRoots.clear();
    resetRevealState();
    hideRevealButton();
    withObserverPaused(() => {
      clearManagedEffects();
      applyProfiles(document);
    });
    configurePiiRefresh();
  }

  function applyProfiles(
    root,
    { skipPii = false, skipConditional = false, skipNativeMedia = false } = {}
  ) {
    if (!profiles.length || !root) return;

    if (!skipPii) applyPiiProfiles(root);

    for (const { radius, sourceId } of scanPlan.mediaProfiles) {
      if (!skipNativeMedia) {
        findWithin(root, MEDIA_SELECTOR)
          .forEach((element) => markTarget(element, radius, sourceId));
      }
      findBackgroundTargets(root, false).forEach((element) => markBackgroundTarget(element, radius, sourceId));
    }

    for (const { profile, rule, radius, sourceId } of scanPlan.rules) {
      if (
        skipConditional
        && rule.kind === "section"
        && rule.condition === BlurTextConditions.SECTION_CONDITIONS.TRIGGER
      ) {
        continue;
      }
      const matches = safeQueryWithin(root, rule.selector);
      for (const element of matches) {
        if (rule.kind === "section") {
          applySectionRule(element, element, profile, rule, radius, sourceId);
        } else {
          markTarget(element, radius, sourceId);
        }
      }

      if (rule.kind === "section" && root instanceof Element) {
        const boundary = safeClosest(root, rule.selector);
        if (boundary && !matches.includes(boundary)) {
          applySectionRule(root, boundary, profile, rule, radius, sourceId);
        }
      }
    }
  }

  function applyPiiProfiles(root) {
    const piiProfiles = scanPlan.piiProfiles;
    if (!piiProfiles.length) return;

    BlurPiiDom.apply(root, {
      onFragment(fragment) {
        markPiiTarget(fragment, piiProfiles);
      },
      onStaticValue(element) {
        markPiiTarget(element, piiProfiles);
      },
      onField(field) {
        trackedPiiFields.add(field);
        updatePiiField(field, piiProfiles);
      }
    });
  }

  function markPiiTarget(target, piiProfiles) {
    for (const profile of piiProfiles) {
      markTarget(
        target,
        BlurCore.blurPixels(profile.blurAmount),
        `${profile.id}:pii`
      );
    }
  }

  function updatePiiField(field, piiProfiles) {
    const activeSourceIds = new Set();

    for (const profile of piiProfiles) {
      const sourceId = `${profile.id}:pii`;
      activeSourceIds.add(sourceId);
      if (BlurPiiDetector.fieldNeedsBlur(field)) {
        markTarget(field, BlurCore.blurPixels(profile.blurAmount), sourceId);
      } else {
        removeTargetSource(field, sourceId);
      }
    }

    for (const sourceId of registry.sourcesFor(field)) {
      if (sourceId.endsWith(":pii") && !activeSourceIds.has(sourceId)) {
        removeTargetSource(field, sourceId);
      }
    }
    field.classList.toggle(
      BlurPiiDom.FIELD_CLASS,
      [...registry.sourcesFor(field)].some((sourceId) => sourceId.endsWith(":pii"))
    );
  }

  function applySectionRule(scope, boundary, profile, rule, radius, sourceId) {
    if (sectionRuleMatchesCondition(boundary, profile, rule)) {
      const blurScope = rule.condition === BlurTextConditions.SECTION_CONDITIONS.TRIGGER
        ? boundary
        : scope;
      blurSectionRuleTargets(blurScope, boundary, rule, radius, sourceId);
    } else {
      unblurSectionSource(boundary, sourceId);
    }
  }

  function sectionRuleMatchesCondition(boundary, profile, rule) {
    if (rule.condition !== BlurTextConditions.SECTION_CONDITIONS.TRIGGER) return true;

    return BlurSectionTargets.some(boundary, rule.targetSelectors, (target) =>
      BlurTextConditions.shouldBlurSection(target, rule.condition, profile)
    );
  }

  function guardNativeMediaTargets(targets) {
    if (!profiles.length) return;

    for (const target of targets) {
      for (const { radius, sourceId } of scanPlan.mediaProfiles) {
        markTarget(target, radius, sourceId);
      }

      for (const { profile, rule, radius, sourceId } of scanPlan.rules) {
        if (rule.kind === "section") {
          const boundary = safeClosest(target, rule.selector);
          if (!boundary || !sectionRuleMatchesCondition(boundary, profile, rule)) {
            continue;
          }
          if (!BlurSectionTargets.contains(boundary, target, rule.targetSelectors)) continue;
          boundary.classList.add(SECTION_CLASS);
          markTarget(target, radius, sourceId, boundary);
        } else if (safeClosest(target, rule.selector) === target) {
          markTarget(target, radius, sourceId);
        }
      }
    }
  }

  function guardConditionalSections(roots) {
    if (!roots.size || !hasConditionalSectionRules()) return;

    for (const { profile, rule, radius, sourceId } of scanPlan.conditionalRules) {
      const boundaries = new Set();
      for (const root of roots) {
        safeQueryWithin(root, rule.selector).forEach((boundary) => boundaries.add(boundary));
        const boundary = safeClosest(root, rule.selector);
        if (boundary) boundaries.add(boundary);
      }
      boundaries.forEach((boundary) => {
        applySectionRule(boundary, boundary, profile, rule, radius, sourceId);
      });
    }
  }

  function guardPiiRoots(roots) {
    if (!roots.size || !scanPlan.piiProfiles.length) return;
    const scanRoots = new Set();
    roots.forEach((root) => {
      scanRoots.add(root);
      if (root.parentElement) scanRoots.add(root.parentElement);
    });
    BlurMediaLifecycle.collapseRoots(scanRoots).forEach(applyPiiProfiles);
  }

  function handleSensitiveFieldInput(event) {
    if (
      !(event.target instanceof Element) ||
      !event.target.matches(BlurPiiDom.FIELD_SELECTOR)
    ) {
      return;
    }
    withObserverPaused(() => updatePiiField(
      event.target,
      scanPlan.piiProfiles
    ));
  }

  function configurePiiRefresh() {
    clearInterval(piiRefreshTimer);
    piiRefreshTimer = undefined;
    if (!pageFeaturesActive || !scanPlan.piiProfiles.length) return;
    piiRefreshTimer = setInterval(refreshPiiFields, 2000);
  }

  function refreshPiiFields() {
    if (
      !pageFeaturesActive
      || document.hidden
      || !scanPlan.piiProfiles.length
    ) return;
    withObserverPaused(() => {
      for (const field of trackedPiiFields) {
        if (field.isConnected === false) {
          trackedPiiFields.delete(field);
          continue;
        }
        updatePiiField(field, scanPlan.piiProfiles);
      }
    });
  }

  function handleRevealKeydown(event) {
    if (!event.altKey || event.key.toLowerCase() !== "r") return;
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest(`.${MANAGED_TARGET_CLASS}`);
    const section = event.target.closest(`.${SECTION_CLASS}`);
    if (event.shiftKey && section) {
      event.preventDefault();
      toggleSectionReveal(section);
      return;
    }
    if (!target) return;
    event.preventDefault();
    toggleTargetReveal(target);
  }

  function toggleTargetReveal(target) {
    if (revealedTargets.has(target)) revealedTargets.delete(target);
    else revealedTargets.add(target);
    updateTargetAppearance(target);
    renderRevealControl();
  }

  function toggleSectionReveal(section) {
    if (revealedSections.has(section)) revealedSections.delete(section);
    else revealedSections.add(section);
    registry.targetsForSection(section).forEach(updateTargetAppearance);
    renderRevealControl();
  }

  function resetRevealState() {
    revealedTargets = new WeakSet();
    revealedSections = new WeakSet();
  }

  function blurSectionRuleTargets(scope, boundary, rule, radius, sourceId) {
    const targets = rule.targetSelectors.length
      ? BlurSectionTargets.resolve(boundary, rule.targetSelectors)
      : [scope];
    targets.forEach((target) => blurSection(target, radius, sourceId, boundary));
  }

  function blurSection(scope, radius, sourceId, boundary) {
    boundary.classList.add(SECTION_CLASS);
    findWithin(scope, MEDIA_SELECTOR)
      .forEach((element) => markTarget(element, radius, sourceId, boundary));
    findBackgroundTargets(scope, true)
      .forEach((element) => markBackgroundTarget(element, radius, sourceId, boundary));
    findWithin(scope, SECTION_CONTROL_SELECTOR)
      .forEach((element) => markTarget(element, radius, sourceId, boundary));
    findWithin(scope, `.${TEXT_FRAGMENT_CLASS}`)
      .forEach((element) => markTarget(element, radius, sourceId, boundary));
    findWithin(scope, `.${PII_FRAGMENT_CLASS}`)
      .forEach((element) => markTarget(element, radius, sourceId, boundary));
    findWithin(scope, `.${BlurPiiDom.STATIC_VALUE_CLASS}`)
      .forEach((element) => markTarget(element, radius, sourceId, boundary));

    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
        if (!node.parentElement || EXCLUDED_TEXT_PARENTS.has(node.parentElement.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (
          node.parentElement.closest(
            `.${TEXT_FRAGMENT_CLASS}, .${PII_FRAGMENT_CLASS}, ` +
              `.${BlurPiiDom.STATIC_VALUE_CLASS}, [contenteditable="true"]`
          )
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    for (const textNode of textNodes) {
      const fragment = document.createElement("span");
      fragment.className = TEXT_FRAGMENT_CLASS;
      textNode.parentNode?.replaceChild(fragment, textNode);
      fragment.append(textNode);
      markTarget(fragment, radius, sourceId, boundary);
    }
  }

  function unblurSectionSource(section, sourceId) {
    const affectedTargets = registry.removeSectionSource(section, sourceId);
    const parentsToNormalise = new Set();

    affectedTargets.forEach((target) => {
      if (registry.sourcesFor(target).size) {
        target.style.setProperty("--blur-extension-radius", `${registry.radiusFor(target)}px`);
        updateTargetAppearance(target);
        return;
      }

      revealedTargets.delete(target);
      restoreKeyboardReveal(target);
      target.classList.remove(
        MANAGED_TARGET_CLASS,
        BACKGROUND_TARGET_CLASS,
        REVEALED_CLASS
      );
      target.style.removeProperty("--blur-extension-radius");

      if (target.classList.contains(TEXT_FRAGMENT_CLASS)) {
        if (target.parentElement) parentsToNormalise.add(target.parentElement);
        target.replaceWith(...target.childNodes);
      }
    });

    parentsToNormalise.forEach((parent) => parent.normalize());
    if (!registry.targetsForSection(section).size) {
      section.classList.remove(SECTION_CLASS);
    }
  }

  function markTarget(element, radius, sourceId, section) {
    if (!(element instanceof Element) || element.closest("#blur-extension-ui-host")) return;

    if (section) {
      registry.addSectionTarget(section, element, sourceId, radius);
    } else {
      registry.addTarget(element, sourceId, radius);
    }
    element.classList.add(MANAGED_TARGET_CLASS);
    enableKeyboardReveal(element);
    element.style.setProperty("--blur-extension-radius", `${registry.radiusFor(element)}px`);
    updateTargetAppearance(element);
  }

  function markBackgroundTarget(element, radius, sourceId, section) {
    element.classList.add(BACKGROUND_TARGET_CLASS);
    markTarget(element, radius, sourceId, section);
  }

  function removeTargetSource(target, sourceId) {
    if (!registry.removeTargetSource(target, sourceId)) return;
    if (registry.sourcesFor(target).size) {
      target.style.setProperty("--blur-extension-radius", `${registry.radiusFor(target)}px`);
      updateTargetAppearance(target);
      return;
    }

    revealedTargets.delete(target);
    restoreKeyboardReveal(target);
    target.classList.remove(MANAGED_TARGET_CLASS, REVEALED_CLASS);
    target.style.removeProperty("--blur-extension-radius");
  }

  function updateTargetAppearance(target) {
    target.classList.toggle(
      REVEALED_CLASS,
      BlurModel.isTargetRevealed(registry, target, revealedTargets, revealedSections)
    );
  }

  function clearManagedEffects() {
    document.querySelectorAll(`.${MANAGED_TARGET_CLASS}`).forEach((element) => {
      restoreKeyboardReveal(element);
      element.classList.remove(
        MANAGED_TARGET_CLASS,
        REVEALED_CLASS,
        BlurPiiDom.FIELD_CLASS
      );
      element.style.removeProperty("--blur-extension-radius");
    });

    document.querySelectorAll(`.${BACKGROUND_TARGET_CLASS}`).forEach((element) => {
      element.classList.remove(BACKGROUND_TARGET_CLASS);
    });
    document.querySelectorAll(`.${SECTION_CLASS}`).forEach((element) => {
      element.classList.remove(SECTION_CLASS);
    });
    document.querySelectorAll(`.${TEXT_FRAGMENT_CLASS}`).forEach((fragment) => {
      fragment.replaceWith(...fragment.childNodes);
    });
    BlurPiiDom.clear(document);
    registry.clear();
  }

  function enableKeyboardReveal(element) {
    if (
      element.hasAttribute("tabindex")
      || !element.matches(`${MEDIA_SELECTOR}, .${BACKGROUND_TARGET_CLASS}`)
    ) return;
    element.dataset.blurExtensionAddedTabindex = "true";
    element.tabIndex = 0;
  }

  function restoreKeyboardReveal(element) {
    if (element.dataset.blurExtensionAddedTabindex !== "true") return;
    delete element.dataset.blurExtensionAddedTabindex;
    element.removeAttribute("tabindex");
  }

  function findWithin(root, selector) {
    const matches = root instanceof Element && root.matches(selector) ? [root] : [];
    return matches.concat([...root.querySelectorAll(selector)]);
  }

  function safeQueryWithin(root, selector) {
    try {
      const matches = root instanceof Element && root.matches(selector) ? [root] : [];
      return matches.concat([...root.querySelectorAll(selector)]);
    } catch (error) {
      console.warn("Blur skipped an invalid selector", selector, error);
      return [];
    }
  }

  function safeClosest(element, selector) {
    try {
      return element.closest(selector);
    } catch {
      return null;
    }
  }

  function findBackgroundTargets(root, exhaustive) {
    const selector = exhaustive ? "*" : BACKGROUND_CANDIDATE_SELECTOR;
    return findWithin(root, selector).filter(hasImageBackground);
  }

  function hasImageBackground(element) {
    return BlurModel.isImageBackground(getComputedStyle(element).backgroundImage);
  }

  function withObserverPaused(callback) {
    const wasObserving = Boolean(observer);
    if (wasObserving) observer.disconnect();
    try {
      callback();
    } finally {
      if (wasObserving) observer.observe(document, currentObserverOptions());
    }
  }

  function currentObserverOptions() {
    return BlurMediaLifecycle.observerOptions(needsTextObservation());
  }

  function needsTextObservation() {
    return scanPlan.needsTextObservation;
  }

  function hasConditionalSectionRules() {
    return scanPlan.conditionalRules.length > 0;
  }

  function createRevealControl() {
    const host = document.createElement("div");
    host.id = "blur-extension-ui-host";
    const shadow = host.attachShadow({ mode: "closed" });
    const panel = document.createElement("div");
    const targetButton = document.createElement("button");
    const sectionButton = document.createElement("button");
    const style = document.createElement("style");

    style.textContent = `
      :host { all: initial; position: fixed; z-index: 2147483647; inset: 0 auto auto 0; pointer-events: none; }
      div {
        display: none;
        position: fixed;
        gap: 5px;
        padding: 4px;
        border: 1px solid rgba(255,255,255,.2);
        border-radius: 10px;
        background: #111317;
        box-shadow: 0 8px 24px rgba(0,0,0,.3);
        pointer-events: auto;
      }
      div[data-visible="true"] { display: flex; }
      button {
        min-height: 32px;
        padding: 6px 10px;
        border: 0;
        border-radius: 7px;
        background: #252a31;
        color: #fff;
        font: 700 12px/1.2 "Avenir Next", "Century Gothic", sans-serif;
        letter-spacing: .02em;
        cursor: pointer;
      }
      button:hover { background: #353b44; }
      button[hidden] { display: none; }
      button[data-kind="section"] { color: #ff9b84; }
      button:focus-visible { outline: 3px solid #ff6b4a; outline-offset: 2px; }
    `;
    targetButton.type = "button";
    sectionButton.type = "button";
    sectionButton.dataset.kind = "section";
    panel.append(targetButton, sectionButton);
    shadow.append(style, panel);
    appendWhenReady(host);

    targetButton.addEventListener("click", () => {
      const target = revealControl?.target;
      if (!target) return;
      toggleTargetReveal(target);
    });

    sectionButton.addEventListener("click", () => {
      const section = revealControl?.section;
      if (!section) return;
      toggleSectionReveal(section);
    });

    revealControl = { host, panel, targetButton, sectionButton, target: null, section: null };
    const signal = pageFeatureController.signal;
    window.addEventListener("scroll", hideRevealButton, { passive: true, signal });
    window.addEventListener("resize", hideRevealButton, { passive: true, signal });
  }

  function handleMediaPointerOver(event) {
    if (!(event.target instanceof Element) || event.target.closest("#blur-extension-ui-host")) return;

    ensureHoveredBackgroundIsBlurred(event.target);
    const target = event.target.closest(
      `.${MANAGED_TARGET_CLASS}:not(.${TEXT_FRAGMENT_CLASS}):not(.${PII_FRAGMENT_CLASS})`
    );
    const section = event.target.closest(`.${SECTION_CLASS}`);
    if (!target && !section) return hideRevealButton();

    revealControl.target = target;
    revealControl.section = section;
    positionRevealControl(target ?? section);
    renderRevealControl();
  }

  function handleMediaPointerOut(event) {
    if (!revealControl?.target && !revealControl?.section) return;
    if (event.relatedTarget instanceof Node) {
      if (revealControl.target?.contains(event.relatedTarget)) return;
      if (revealControl.section?.contains(event.relatedTarget)) return;
    }
    setTimeout(() => {
      if (revealControl?.panel.matches(":hover")) return;
      hideRevealButton();
    }, 80);
  }

  function ensureHoveredBackgroundIsBlurred(element) {
    if (!scanPlan.mediaProfiles.length) return;

    let candidate = element;
    for (let depth = 0; candidate && depth < 4; depth += 1) {
      if (hasImageBackground(candidate)) {
        const section = candidate.closest(`.${SECTION_CLASS}`);
        for (const { radius, sourceId } of scanPlan.mediaProfiles) {
          markBackgroundTarget(
            candidate,
            radius,
            sourceId,
            section
          );
        }
        return;
      }
      candidate = candidate.parentElement;
    }
  }

  function setProfiles(nextProfiles) {
    profiles = nextProfiles;
    scanPlan = BlurScanPlan.create(profiles);
  }

  function positionRevealControl(anchor) {
    const rect = anchor.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 24) return hideRevealButton();

    revealControl.panel.style.left = `${Math.max(8, Math.min(innerWidth - 220, rect.left + 8))}px`;
    revealControl.panel.style.top = `${Math.max(8, rect.top + 8)}px`;
    revealControl.panel.dataset.visible = "true";
  }

  function renderRevealControl() {
    const { target, section, targetButton, sectionButton } = revealControl;
    const targetRevealedBySection = target && [...registry.sectionsForTarget(target)]
      .some((owner) => revealedSections.has(owner));
    targetButton.hidden = !target || targetRevealedBySection;
    sectionButton.hidden = !section;

    if (target) {
      const noun = target.matches("video")
        ? "video"
        : target.matches("img") || target.classList.contains(BACKGROUND_TARGET_CLASS)
          ? "image"
          : "element";
      targetButton.textContent = `${revealedTargets.has(target) ? "Blur" : "Reveal"} ${noun}`;
    }
    if (section) {
      sectionButton.textContent = `${revealedSections.has(section) ? "Blur" : "Reveal"} section`;
    }
  }

  function hideRevealButton() {
    if (!revealControl) return;
    revealControl.panel.dataset.visible = "false";
    revealControl.target = null;
    revealControl.section = null;
  }

  function startPicker(profileId, kind) {
    stopPicker();

    const profile = state.profiles.find((item) => item.id === profileId);
    if (!profile) return showToast("Profile no longer exists");

    const host = document.createElement("div");
    host.id = "blur-extension-picker-host";
    const shadow = host.attachShadow({ mode: "closed" });
    const bar = document.createElement("div");
    const style = document.createElement("style");
    const action = kind === "section" ? "section" : "element";
    const message = document.createElement("span");
    const drawBox = document.createElement("div");
    const drawButton = action === "section" ? document.createElement("button") : null;

    style.textContent = `
      :host { all: initial; }
      .banner {
        position: fixed;
        z-index: 2147483647;
        top: 16px;
        left: 50%;
        display: flex;
        align-items: center;
        gap: 10px;
        transform: translateX(-50%);
        max-width: calc(100vw - 32px);
        padding: 10px 14px;
        border: 1px solid rgba(255,255,255,.22);
        border-radius: 10px;
        background: #111317;
        box-shadow: 0 14px 42px rgba(0,0,0,.4);
        color: #f8f4ed;
        font: 600 13px/1.3 "Avenir Next", "Century Gothic", sans-serif;
      }
      .message { white-space: nowrap; }
      button {
        min-height: 28px;
        padding: 4px 9px;
        border: 1px solid #ff8b70;
        border-radius: 6px;
        background: rgba(255,107,74,.1);
        color: #ffad9a;
        cursor: pointer;
        font: 700 11px/1.2 "Avenir Next", "Century Gothic", sans-serif;
      }
      button:hover,
      button[aria-pressed="true"] {
        background: #ff6b4a;
        color: #111317;
      }
      kbd {
        padding: 2px 5px;
        border: 1px solid #555a62;
        border-radius: 4px;
        color: #b8bdc6;
        font: 11px/1.2 ui-monospace, monospace;
      }
      .draw-box {
        position: fixed;
        z-index: 2147483646;
        display: none;
        border: 2px solid #ff6b4a;
        border-radius: 4px;
        background: rgba(255,107,74,.12);
        box-shadow: 0 0 0 1px rgba(17,19,23,.35), 0 8px 28px rgba(0,0,0,.18);
        pointer-events: none;
      }
      .draw-box[data-visible="true"] { display: block; }
      @media (max-width: 620px) {
        .banner { flex-wrap: wrap; justify-content: center; width: calc(100vw - 32px); }
        .message { flex-basis: 100%; text-align: center; white-space: normal; }
      }
    `;
    bar.className = "banner";
    message.className = "message";
    drawBox.className = "draw-box";
    bar.append(message);
    if (drawButton) {
      drawButton.type = "button";
      drawButton.textContent = "Draw area";
      drawButton.setAttribute("aria-pressed", "false");
      drawButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setPickerDrawMode(!picker?.drawMode);
      });
      bar.append(drawButton);
    }
    const key = document.createElement("kbd");
    key.textContent = "Esc";
    bar.append(key);
    shadow.append(style, drawBox, bar);
    appendWhenReady(host);

    picker = {
      profileId,
      kind: action,
      host,
      candidate: null,
      pointerTarget: null,
      highlighted: new Set(),
      message,
      drawButton,
      drawBox,
      drawMode: false,
      drawing: false,
      drawStart: null,
      targetSelectors: []
    };
    updatePickerBanner();
    document.addEventListener("pointerdown", handlePickerPointerDown, true);
    document.addEventListener("pointermove", handlePickerMove, true);
    document.addEventListener("pointerup", handlePickerPointerUp, true);
    document.addEventListener("pointercancel", cancelPickerDraw, true);
    document.addEventListener("click", handlePickerClick, true);
    document.addEventListener("keydown", handlePickerKeydown, true);
  }

  function handlePickerMove(event) {
    if (!picker) return;
    if (picker.drawMode) {
      if (picker.drawing) updatePickerDrawBox(event);
      return;
    }
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("#blur-extension-picker-host, #blur-extension-ui-host")) return;
    picker.pointerTarget = event.target;
    setPickerCandidate(
      picker.kind === "section"
        ? BlurSelectors.findSectionCandidate(event.target, document)
        : event.target
    );
  }

  function handlePickerPointerDown(event) {
    if (!picker?.drawMode || event.button !== 0 || event.isPrimary === false) return;
    if (event.target instanceof Element &&
      event.target.closest("#blur-extension-picker-host, #blur-extension-ui-host")) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    clearPickerHighlights();
    picker.candidate = null;
    picker.drawing = true;
    picker.drawStart = { x: event.clientX, y: event.clientY };
    updatePickerDrawBox(event);
    updatePickerBanner();
  }

  async function handlePickerPointerUp(event) {
    if (!picker?.drawMode || !picker.drawing) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const rectangle = BlurDrawSelection.rectangleFromPoints(
      picker.drawStart,
      { x: event.clientX, y: event.clientY }
    );
    picker.drawing = false;
    picker.drawBox.dataset.visible = "false";

    if (!BlurDrawSelection.isUsableRectangle(rectangle)) {
      updatePickerBanner();
      showToast("Draw a larger area around the section content");
      return;
    }

    const selectedElements = BlurDrawSelection.collectElements(document, rectangle);
    const candidate = BlurSelectors.findSectionCandidateFromElements(selectedElements, document);
    if (!candidate) {
      updatePickerBanner();
      showToast("Could not find one section around that area");
      return;
    }

    const targetSelectors = BlurSelectors.buildRelativeSelectors(candidate, selectedElements);
    if (!targetSelectors.length) {
      updatePickerBanner();
      showToast("Could not identify the content inside that area");
      return;
    }

    setPickerCandidate(candidate);
    picker.targetSelectors = targetSelectors;
    const selector = BlurSelectors.buildSelector(candidate, document, { matchGroup: true });
    const matchCount = selector ? safeQueryWithin(document, selector).length : 0;
    picker.message.textContent = `Found ${matchCount || 1} matching ${matchCount === 1 ? "section" : "sections"} · adding…`;
    suppressNextPickerClick();
    await commitPickerCandidate();
  }

  function cancelPickerDraw() {
    if (!picker?.drawing) return;
    picker.drawing = false;
    picker.drawStart = null;
    picker.drawBox.dataset.visible = "false";
    updatePickerBanner();
  }

  async function handlePickerClick(event) {
    if (!picker) return;
    if (event.target instanceof Element &&
      event.target.closest("#blur-extension-picker-host, #blur-extension-ui-host")) return;
    if (picker.drawMode) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!picker.candidate) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    await commitPickerCandidate();
  }

  async function commitPickerCandidate() {
    if (!picker?.candidate) return;
    const candidate = picker.candidate;
    const profileId = picker.profileId;
    const kind = picker.kind;
    const targetSelectors = kind === "section" ? picker.targetSelectors : [];
    candidate.classList.remove(PICKER_CLASS);
    const selector = BlurSelectors.buildSelector(candidate, document, { matchGroup: kind === "section" });
    const targetLabel = targetSelectors.length
      ? ` · ${targetSelectors.length} ${targetSelectors.length === 1 ? "target" : "targets"}`
      : "";
    const label = `${BlurSelectors.describeElement(candidate)}${targetLabel}`.slice(0, 80);
    stopPicker();

    if (!selector) return showToast("Could not create a stable selector");
    const matchCount = kind === "section" ? safeQueryWithin(document, selector).length : 1;

    const stored = await chrome.storage.local.get(BlurCore.STORAGE_KEY);
    const nextState = BlurCore.normaliseState(stored[BlurCore.STORAGE_KEY]);
    const profile = nextState.profiles.find((item) => item.id === profileId);
    if (!profile) return showToast("Profile no longer exists");

    const duplicate = profile.rules.some((rule) =>
      rule.selector === selector &&
      rule.kind === kind &&
      BlurSectionTargets.sameSelectors(rule.targetSelectors, targetSelectors)
    );
    if (duplicate) return showToast("That selection is already in this profile");

    const broadSectionRule = targetSelectors.length
      ? profile.rules.find((rule) =>
        rule.selector === selector &&
        rule.kind === "section" &&
        !rule.targetSelectors.length
      )
      : null;
    if (broadSectionRule) {
      broadSectionRule.targetSelectors = targetSelectors;
      broadSectionRule.label = label;
      await chrome.storage.local.set({ [BlurCore.STORAGE_KEY]: nextState });
      showToast(
        `${matchCount} matching ${matchCount === 1 ? "section" : "sections"} narrowed to drawn content`
      );
      return;
    }

    profile.rules.push({
      id: crypto.randomUUID(),
      selector,
      kind,
      label,
      enabled: true,
      targetSelectors,
      condition: BlurTextConditions.SECTION_CONDITIONS.ALWAYS
    });
    await chrome.storage.local.set({ [BlurCore.STORAGE_KEY]: nextState });
    showToast(kind === "section"
      ? `${matchCount} matching ${matchCount === 1 ? "section" : "sections"} added to ${profile.name}`
      : `Element added to ${profile.name}`);
  }

  function handlePickerKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      stopPicker();
      showToast("Selection cancelled");
      return;
    }

    if (!picker || picker.kind !== "section" || picker.drawMode ||
      !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "ArrowUp"
      ? picker.candidate?.parentElement
      : BlurSelectors.childTowards(picker.candidate, picker.pointerTarget);
    if (next && !["HTML", "BODY"].includes(next.tagName)) setPickerCandidate(next);
  }

  function setPickerCandidate(candidate) {
    if (!picker || !(candidate instanceof Element) || candidate === picker.candidate) return;
    clearPickerHighlights();
    picker.candidate = candidate;
    const selector = picker.kind === "section"
      ? BlurSelectors.buildSelector(candidate, document, { matchGroup: true })
      : "";
    const matches = selector ? safeQueryWithin(document, selector) : [candidate];
    picker.highlighted = new Set(matches);
    picker.highlighted.forEach((element) => element.classList.add(PICKER_CLASS));
  }

  function setPickerDrawMode(enabled) {
    if (!picker || picker.kind !== "section") return;
    clearPickerHighlights();
    picker.candidate = null;
    picker.pointerTarget = null;
    picker.drawing = false;
    picker.drawStart = null;
    picker.targetSelectors = [];
    picker.drawMode = Boolean(enabled);
    picker.drawBox.dataset.visible = "false";
    picker.drawButton.setAttribute("aria-pressed", String(picker.drawMode));
    picker.drawButton.textContent = picker.drawMode ? "Drawing on" : "Draw area";
    document.documentElement.classList.toggle("blur-extension-draw-mode", picker.drawMode);
    updatePickerBanner();
  }

  function updatePickerBanner() {
    if (!picker) return;
    if (picker.kind !== "section") {
      picker.message.textContent = "Choose an element to blur";
      return;
    }
    if (!picker.drawMode) {
      picker.message.textContent = "Choose a card type · all matches · ↑ broader · ↓ narrower";
      return;
    }
    picker.message.textContent = picker.drawing
      ? "Release to find and add the matching card type"
      : "Drag around the content that belongs in one section";
  }

  function updatePickerDrawBox(event) {
    if (!picker?.drawing) return;
    const rectangle = BlurDrawSelection.rectangleFromPoints(
      picker.drawStart,
      { x: event.clientX, y: event.clientY }
    );
    Object.assign(picker.drawBox.style, {
      left: `${rectangle.left}px`,
      top: `${rectangle.top}px`,
      width: `${rectangle.width}px`,
      height: `${rectangle.height}px`
    });
    picker.drawBox.dataset.visible = "true";
  }

  function suppressNextPickerClick() {
    const suppress = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      clearTimeout(timeout);
    };
    const timeout = setTimeout(() => document.removeEventListener("click", suppress, true), 250);
    document.addEventListener("click", suppress, { capture: true, once: true });
  }

  function clearPickerHighlights() {
    picker?.highlighted?.forEach((element) => element.classList.remove(PICKER_CLASS));
    if (picker?.highlighted) picker.highlighted.clear();
  }

  function stopPicker() {
    clearPickerHighlights();
    document.documentElement.classList.remove("blur-extension-draw-mode");
    picker?.host.remove();
    picker = null;
    document.removeEventListener("pointerdown", handlePickerPointerDown, true);
    document.removeEventListener("pointermove", handlePickerMove, true);
    document.removeEventListener("pointerup", handlePickerPointerUp, true);
    document.removeEventListener("pointercancel", cancelPickerDraw, true);
    document.removeEventListener("click", handlePickerClick, true);
    document.removeEventListener("keydown", handlePickerKeydown, true);
  }

  function showToast(message) {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "closed" });
    const toast = document.createElement("div");
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      div {
        position: fixed;
        z-index: 2147483647;
        right: 18px;
        bottom: 18px;
        max-width: 320px;
        padding: 11px 14px;
        border-left: 4px solid #ff6b4a;
        border-radius: 8px;
        background: #111317;
        box-shadow: 0 14px 42px rgba(0,0,0,.38);
        color: #f8f4ed;
        font: 600 13px/1.35 "Avenir Next", "Century Gothic", sans-serif;
      }
    `;
    toast.textContent = message;
    shadow.append(style, toast);
    appendWhenReady(host);
    setTimeout(() => host.remove(), 2600);
  }

  function appendWhenReady(element) {
    if (document.documentElement) {
      document.documentElement.append(element);
      return;
    }
    document.addEventListener("readystatechange", () => document.documentElement?.append(element), { once: true });
  }

  function reportStatus() {
    chrome.runtime.sendMessage({ type: "PAGE_STATUS", profileCount: profiles.length }).catch(() => {});
  }

  function reportError(error) {
    console.error("Blur could not initialise", error);
  }
})();
