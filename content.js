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
    "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "BUTTON"
  ]);
  const MANAGED_TARGET_CLASS = "blur-extension-target";
  const BACKGROUND_TARGET_CLASS = "blur-extension-background-target";
  const SECTION_CLASS = "blur-extension-section";
  const TEXT_FRAGMENT_CLASS = "blur-extension-text-fragment";
  const REVEALED_CLASS = "blur-extension-revealed";
  const PICKER_CLASS = "blur-extension-picker-candidate";

  let state = BlurCore.createDefaultState();
  let profiles = [];
  let observer;
  let picker;
  let revealControl;
  let pendingRoots = new Set();
  let applyFrame;
  let currentDocumentUrl = location.href;
  const registry = BlurModel.createRegistry();
  const revealedTargets = new WeakSet();
  const revealedSections = new WeakSet();

  initialise().catch(reportError);

  async function initialise() {
    const stored = await chrome.storage.local.get(BlurCore.STORAGE_KEY);
    state = BlurCore.normaliseState(stored[BlurCore.STORAGE_KEY]);
    profiles = BlurCore.matchingProfiles(state, location.href);

    applyProfiles(document);
    observePage();
    createRevealControl();
    reportStatus();

    chrome.storage.onChanged.addListener(handleStorageChange);
    chrome.runtime.onMessage.addListener(handleMessage);
    document.addEventListener("pointerover", handleMediaPointerOver, true);
    document.addEventListener("pointerout", handleMediaPointerOut, true);
    window.addEventListener("popstate", refreshProfilesForCurrentUrl);
    window.addEventListener("hashchange", refreshProfilesForCurrentUrl);
    window.addEventListener("load", reapplyAll, { once: true });
    window.navigation?.addEventListener("navigatesuccess", refreshProfilesForCurrentUrl);
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== "local" || !changes[BlurCore.STORAGE_KEY]) return;
    state = BlurCore.normaliseState(changes[BlurCore.STORAGE_KEY].newValue);
    profiles = BlurCore.matchingProfiles(state, location.href);
    reapplyAll();
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
      if (mediaTargets.size) {
        withObserverPaused(() => guardNativeMediaTargets(mediaTargets));
      }

      BlurMediaLifecycle.collectDeferredRoots(mutations)
        .forEach((root) => pendingRoots.add(root));
      scheduleApply();
    });
    observer.observe(document, BlurMediaLifecycle.OBSERVER_OPTIONS);
  }

  function refreshProfilesForCurrentUrl() {
    if (location.href === currentDocumentUrl) return false;
    currentDocumentUrl = location.href;
    profiles = BlurCore.matchingProfiles(state, currentDocumentUrl);
    reapplyAll();
    reportStatus();
    return true;
  }

  function scheduleApply() {
    if (applyFrame || !pendingRoots.size) return;
    applyFrame = requestAnimationFrame(() => {
      applyFrame = undefined;
      const roots = [...pendingRoots];
      pendingRoots = new Set();
      withObserverPaused(() => roots.forEach(applyProfiles));
    });
  }

  function reapplyAll() {
    if (applyFrame) cancelAnimationFrame(applyFrame);
    applyFrame = undefined;
    pendingRoots.clear();
    withObserverPaused(() => {
      clearManagedEffects();
      applyProfiles(document);
    });
  }

  function applyProfiles(root) {
    if (!profiles.length || !root) return;

    for (const profile of profiles) {
      const radius = BlurCore.blurPixels(profile.blurAmount);

      if (profile.blurMedia) {
        const sourceId = `${profile.id}:media`;
        findWithin(root, MEDIA_SELECTOR).forEach((element) => markTarget(element, radius, sourceId));
        findBackgroundTargets(root, false).forEach((element) => markBackgroundTarget(element, radius, sourceId));
      }

      for (const rule of profile.rules) {
        if (!rule.enabled) continue;
        const sourceId = `${profile.id}:${rule.id}`;
        const matches = safeQueryWithin(root, rule.selector);
        for (const element of matches) {
          if (rule.kind === "section") {
            blurSection(element, radius, sourceId, element);
          } else {
            markTarget(element, radius, sourceId);
          }
        }

        if (rule.kind === "section" && root instanceof Element) {
          const boundary = safeClosest(root, rule.selector);
          if (boundary && !matches.includes(boundary)) blurSection(root, radius, sourceId, boundary);
        }
      }
    }
  }

  function guardNativeMediaTargets(targets) {
    if (!profiles.length) return;

    for (const target of targets) {
      for (const profile of profiles) {
        const radius = BlurCore.blurPixels(profile.blurAmount);

        if (profile.blurMedia) {
          markTarget(target, radius, `${profile.id}:media`);
        }

        for (const rule of profile.rules) {
          if (!rule.enabled) continue;
          const sourceId = `${profile.id}:${rule.id}`;

          if (rule.kind === "section") {
            const boundary = safeClosest(target, rule.selector);
            if (!boundary) continue;
            boundary.classList.add(SECTION_CLASS);
            markTarget(target, radius, sourceId, boundary);
          } else if (safeClosest(target, rule.selector) === target) {
            markTarget(target, radius, sourceId);
          }
        }
      }
    }
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

    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
        if (!node.parentElement || EXCLUDED_TEXT_PARENTS.has(node.parentElement.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.parentElement.closest(`.${TEXT_FRAGMENT_CLASS}, [contenteditable="true"]`)) {
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

  function markTarget(element, radius, sourceId, section) {
    if (!(element instanceof Element) || element.closest("#blur-extension-ui-host")) return;

    if (section) {
      registry.addSectionTarget(section, element, sourceId, radius);
    } else {
      registry.addTarget(element, sourceId, radius);
    }
    element.classList.add(MANAGED_TARGET_CLASS);
    element.style.setProperty("--blur-extension-radius", `${registry.radiusFor(element)}px`);
    updateTargetAppearance(element);
  }

  function markBackgroundTarget(element, radius, sourceId, section) {
    element.classList.add(BACKGROUND_TARGET_CLASS);
    markTarget(element, radius, sourceId, section);
  }

  function updateTargetAppearance(target) {
    target.classList.toggle(
      REVEALED_CLASS,
      BlurModel.isTargetRevealed(registry, target, revealedTargets, revealedSections)
    );
  }

  function clearManagedEffects() {
    document.querySelectorAll(`.${MANAGED_TARGET_CLASS}`).forEach((element) => {
      element.classList.remove(MANAGED_TARGET_CLASS, REVEALED_CLASS);
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
    registry.clear();
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
      if (wasObserving) observer.observe(document, BlurMediaLifecycle.OBSERVER_OPTIONS);
    }
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
      if (revealedTargets.has(target)) {
        revealedTargets.delete(target);
      } else {
        revealedTargets.add(target);
      }
      updateTargetAppearance(target);
      renderRevealControl();
    });

    sectionButton.addEventListener("click", () => {
      const section = revealControl?.section;
      if (!section) return;
      if (revealedSections.has(section)) {
        revealedSections.delete(section);
      } else {
        revealedSections.add(section);
      }
      registry.targetsForSection(section).forEach(updateTargetAppearance);
      renderRevealControl();
    });

    revealControl = { host, panel, targetButton, sectionButton, target: null, section: null };
    window.addEventListener("scroll", () => hideRevealButton(), { passive: true });
    window.addEventListener("resize", () => hideRevealButton(), { passive: true });
  }

  function handleMediaPointerOver(event) {
    if (!(event.target instanceof Element) || event.target.closest("#blur-extension-ui-host")) return;

    ensureHoveredBackgroundIsBlurred(event.target);
    const target = event.target.closest(`.${MANAGED_TARGET_CLASS}:not(.${TEXT_FRAGMENT_CLASS})`);
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
    if (!profiles.some((profile) => profile.blurMedia)) return;

    let candidate = element;
    for (let depth = 0; candidate && depth < 4; depth += 1) {
      if (hasImageBackground(candidate)) {
        const section = candidate.closest(`.${SECTION_CLASS}`);
        for (const profile of profiles) {
          if (!profile.blurMedia) continue;
          markBackgroundTarget(
            candidate,
            BlurCore.blurPixels(profile.blurAmount),
            `${profile.id}:media`,
            section
          );
        }
        return;
      }
      candidate = candidate.parentElement;
    }
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

    style.textContent = `
      :host { all: initial; }
      div {
        position: fixed;
        z-index: 2147483647;
        top: 16px;
        left: 50%;
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
      kbd {
        margin-left: 10px;
        padding: 2px 5px;
        border: 1px solid #555a62;
        border-radius: 4px;
        color: #b8bdc6;
        font: 11px/1.2 ui-monospace, monospace;
      }
    `;
    bar.append(action === "section"
      ? "Choose a card type · all matches · ↑ broader · ↓ narrower"
      : "Choose an element to blur");
    const key = document.createElement("kbd");
    key.textContent = "Esc";
    bar.append(key);
    shadow.append(style, bar);
    appendWhenReady(host);

    picker = {
      profileId,
      kind: action,
      host,
      candidate: null,
      pointerTarget: null,
      highlighted: new Set()
    };
    document.addEventListener("pointermove", handlePickerMove, true);
    document.addEventListener("click", handlePickerClick, true);
    document.addEventListener("keydown", handlePickerKeydown, true);
  }

  function handlePickerMove(event) {
    if (!picker || !(event.target instanceof Element)) return;
    if (event.target.closest("#blur-extension-picker-host, #blur-extension-ui-host")) return;
    picker.pointerTarget = event.target;
    setPickerCandidate(
      picker.kind === "section"
        ? BlurSelectors.findSectionCandidate(event.target, document)
        : event.target
    );
  }

  async function handlePickerClick(event) {
    if (!picker?.candidate) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const candidate = picker.candidate;
    const profileId = picker.profileId;
    const kind = picker.kind;
    candidate.classList.remove(PICKER_CLASS);
    const selector = BlurSelectors.buildSelector(candidate, document, { matchGroup: kind === "section" });
    const label = BlurSelectors.describeElement(candidate);
    stopPicker();

    if (!selector) return showToast("Could not create a stable selector");
    const matchCount = kind === "section" ? safeQueryWithin(document, selector).length : 1;

    const stored = await chrome.storage.local.get(BlurCore.STORAGE_KEY);
    const nextState = BlurCore.normaliseState(stored[BlurCore.STORAGE_KEY]);
    const profile = nextState.profiles.find((item) => item.id === profileId);
    if (!profile) return showToast("Profile no longer exists");

    const duplicate = profile.rules.some((rule) => rule.selector === selector && rule.kind === kind);
    if (duplicate) return showToast("That selection is already in this profile");

    profile.rules.push({ id: crypto.randomUUID(), selector, kind, label, enabled: true });
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

    if (!picker || picker.kind !== "section" || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
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

  function clearPickerHighlights() {
    picker?.highlighted?.forEach((element) => element.classList.remove(PICKER_CLASS));
    if (picker?.highlighted) picker.highlighted.clear();
  }

  function stopPicker() {
    clearPickerHighlights();
    picker?.host.remove();
    picker = null;
    document.removeEventListener("pointermove", handlePickerMove, true);
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
