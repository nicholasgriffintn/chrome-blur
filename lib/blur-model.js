(function initialiseBlurModel(global) {
  "use strict";

  function createRegistry() {
    let sourcesByTarget = new WeakMap();
    let radiusByTarget = new WeakMap();
    let targetsBySection = new WeakMap();
    let sectionsByTarget = new WeakMap();

    function addTarget(target, sourceId, radius) {
      if (!target || !sourceId) return;

      const sources = sourcesByTarget.get(target) ?? new Set();
      sources.add(sourceId);
      sourcesByTarget.set(target, sources);
      radiusByTarget.set(target, Math.max(radiusByTarget.get(target) ?? 0, Number(radius) || 0));
    }

    function addSectionTarget(section, target, sourceId, radius) {
      if (!section || !target) return;
      addTarget(target, sourceId, radius);

      const targets = targetsBySection.get(section) ?? new Set();
      targets.add(target);
      targetsBySection.set(section, targets);

      const sections = sectionsByTarget.get(target) ?? new Set();
      sections.add(section);
      sectionsByTarget.set(target, sections);
    }

    function sourcesFor(target) {
      return new Set(sourcesByTarget.get(target) ?? []);
    }

    function radiusFor(target) {
      return radiusByTarget.get(target) ?? 0;
    }

    function targetsForSection(section) {
      return new Set(targetsBySection.get(section) ?? []);
    }

    function sectionsForTarget(target) {
      return new Set(sectionsByTarget.get(target) ?? []);
    }

    function clear() {
      sourcesByTarget = new WeakMap();
      radiusByTarget = new WeakMap();
      targetsBySection = new WeakMap();
      sectionsByTarget = new WeakMap();
    }

    return Object.freeze({
      addTarget,
      addSectionTarget,
      sourcesFor,
      radiusFor,
      targetsForSection,
      sectionsForTarget,
      clear
    });
  }

  function isImageBackground(backgroundImage) {
    return /(?:^|,|\s)(?:url|image-set)\(/i.test(String(backgroundImage ?? ""));
  }

  function isTargetRevealed(registry, target, revealedTargets, revealedSections) {
    if (revealedTargets.has(target)) return true;
    return [...registry.sectionsForTarget(target)].some((section) => revealedSections.has(section));
  }

  global.BlurModel = Object.freeze({
    createRegistry,
    isImageBackground,
    isTargetRevealed
  });
})(globalThis);
