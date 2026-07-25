(function initialiseBlurSectionTargets(global) {
  "use strict";

  function resolve(boundary, targetSelectors) {
    if (!boundary) return [];
    if (!Array.isArray(targetSelectors) || !targetSelectors.length) return [boundary];

    const targets = new Set();
    targetSelectors.forEach((selector) => {
      if (selector === ":scope") {
        targets.add(boundary);
        return;
      }
      try {
        boundary.querySelectorAll(selector).forEach((target) => targets.add(target));
      } catch {
        // A changed page can invalidate one target without widening the rule.
      }
    });
    return [...targets];
  }

  function contains(boundary, element, targetSelectors) {
    return resolve(boundary, targetSelectors).some((target) =>
      target === element || target.contains?.(element)
    );
  }

  function some(boundary, targetSelectors, predicate) {
    if (typeof predicate !== "function") return false;
    return resolve(boundary, targetSelectors).some(predicate);
  }

  function sameSelectors(left, right) {
    const first = Array.isArray(left) ? left : [];
    const second = Array.isArray(right) ? right : [];
    return first.length === second.length &&
      first.every((selector, index) => selector === second[index]);
  }

  global.BlurSectionTargets = Object.freeze({
    contains,
    resolve,
    some,
    sameSelectors
  });
})(globalThis);
