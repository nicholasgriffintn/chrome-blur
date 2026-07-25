(function initialiseBlurMediaLifecycle(global) {
  "use strict";

  const MEDIA_SELECTOR = "img, video";
  const MEDIA_ATTRIBUTES = Object.freeze(["class", "src", "srcset", "poster"]);
  const OBSERVER_OPTIONS = Object.freeze({
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: MEDIA_ATTRIBUTES
  });

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
      if (mutation.type !== "childList") continue;

      for (const node of mutation.addedNodes ?? []) {
        if (isElement(node)) roots.add(node);
        if (node?.nodeType === 3 && node.parentElement) roots.add(node.parentElement);
      }
    }

    return roots;
  }

  function isNativeMedia(node) {
    return isElement(node) && Boolean(node.matches?.(MEDIA_SELECTOR));
  }

  function isElement(node) {
    return node?.nodeType === 1;
  }

  global.BlurMediaLifecycle = Object.freeze({
    MEDIA_SELECTOR,
    OBSERVER_OPTIONS,
    collectImmediateMediaTargets,
    collectDeferredRoots
  });
})(globalThis);
