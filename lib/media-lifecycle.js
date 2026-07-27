(function initialiseBlurMediaLifecycle(global) {
  "use strict";

  const MEDIA_SELECTOR = "img, video";
  const MEDIA_ATTRIBUTES = Object.freeze(["class", "src", "srcset", "poster"]);
  const TEXT_REEVALUATION_ATTRIBUTES = Object.freeze([
    "alt", "aria-label", "aria-labelledby", "autocomplete", "contenteditable",
    "data-label", "for", "headers", "id", "itemprop", "name", "placeholder",
    "type", "value", ...MEDIA_ATTRIBUTES
  ]);
  const MEDIA_OBSERVER_OPTIONS = Object.freeze({
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: MEDIA_ATTRIBUTES
  });
  const TEXT_OBSERVER_OPTIONS = Object.freeze({
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: TEXT_REEVALUATION_ATTRIBUTES,
    characterData: true
  });

  function observerOptions(includeTextChanges) {
    return includeTextChanges ? TEXT_OBSERVER_OPTIONS : MEDIA_OBSERVER_OPTIONS;
  }

  function collectImmediateMediaTargets(mutations) {
    const targets = new Set();

    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        if (isNativeMedia(mutation.target)) targets.add(mutation.target);
        continue;
      }

      for (const node of mutation.addedNodes ?? []) {
        if (!isElement(node)) continue;
        if (isNativeMedia(node)) targets.add(node);
        node.querySelectorAll?.(MEDIA_SELECTOR).forEach((target) => targets.add(target));
      }
    }

    return targets;
  }

  function collectDeferredRoots(mutations) {
    const roots = new Set();

    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        if (mutation.target?.parentElement) roots.add(mutation.target.parentElement);
        continue;
      }

      if (mutation.type === "attributes") {
        if (
          TEXT_REEVALUATION_ATTRIBUTES.includes(mutation.attributeName) &&
          isElement(mutation.target)
        ) {
          roots.add(mutation.target);
        }
        continue;
      }

      for (const node of mutation.addedNodes ?? []) {
        if (isElement(node)) roots.add(node);
        if (node?.nodeType === 3 && node.parentElement) roots.add(node.parentElement);
      }
    }

    return collapseRoots(roots);
  }

  function collapseRoots(roots) {
    const candidates = [...roots];
    return new Set(candidates.filter((candidate) => !candidates.some((other) => (
      other !== candidate && Boolean(other.contains?.(candidate))
    ))));
  }

  function isNativeMedia(node) {
    return isElement(node) && Boolean(node.matches?.(MEDIA_SELECTOR));
  }

  function isElement(node) {
    return node?.nodeType === 1;
  }

  global.BlurMediaLifecycle = Object.freeze({
    MEDIA_SELECTOR,
    observerOptions,
    collectImmediateMediaTargets,
    collectDeferredRoots,
    collapseRoots
  });
})(globalThis);
