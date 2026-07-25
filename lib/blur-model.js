(function initialiseBlurModel(global) {
  "use strict";

  function createRegistry() {
    let sourceRecordsByTarget = new WeakMap();
    let targetSourcesBySection = new WeakMap();
    let sectionSourcesByTarget = new WeakMap();

    function addTarget(target, sourceId, radius) {
      if (!target || !sourceId) return;

      const records = sourceRecordsByTarget.get(target) ?? new Map();
      const record = records.get(sourceId) ?? { radius: 0, owners: new Set() };
      record.radius = Math.max(record.radius, Number(radius) || 0);
      record.owners.add(null);
      records.set(sourceId, record);
      sourceRecordsByTarget.set(target, records);
    }

    function addSectionTarget(section, target, sourceId, radius) {
      if (!section || !target) return;

      const records = sourceRecordsByTarget.get(target) ?? new Map();
      const record = records.get(sourceId) ?? { radius: 0, owners: new Set() };
      record.radius = Math.max(record.radius, Number(radius) || 0);
      record.owners.add(section);
      records.set(sourceId, record);
      sourceRecordsByTarget.set(target, records);

      const targetSources = targetSourcesBySection.get(section) ?? new Map();
      const sourceIds = targetSources.get(target) ?? new Set();
      sourceIds.add(sourceId);
      targetSources.set(target, sourceIds);
      targetSourcesBySection.set(section, targetSources);

      const sectionSources = sectionSourcesByTarget.get(target) ?? new Map();
      const sectionSourceIds = sectionSources.get(section) ?? new Set();
      sectionSourceIds.add(sourceId);
      sectionSources.set(section, sectionSourceIds);
      sectionSourcesByTarget.set(target, sectionSources);
    }

    function removeSectionSource(section, sourceId) {
      const targetSources = targetSourcesBySection.get(section);
      if (!targetSources) return new Set();

      const affectedTargets = new Set();
      for (const [target, sourceIds] of targetSources) {
        if (!sourceIds.delete(sourceId)) continue;
        affectedTargets.add(target);

        const records = sourceRecordsByTarget.get(target);
        const record = records?.get(sourceId);
        record?.owners.delete(section);
        if (record && !record.owners.size) records.delete(sourceId);
        if (records && !records.size) sourceRecordsByTarget.delete(target);

        const sectionSources = sectionSourcesByTarget.get(target);
        const sectionSourceIds = sectionSources?.get(section);
        sectionSourceIds?.delete(sourceId);
        if (sectionSourceIds && !sectionSourceIds.size) sectionSources.delete(section);
        if (sectionSources && !sectionSources.size) sectionSourcesByTarget.delete(target);

        if (!sourceIds.size) targetSources.delete(target);
      }

      if (!targetSources.size) targetSourcesBySection.delete(section);
      return affectedTargets;
    }

    function removeTargetSource(target, sourceId) {
      const records = sourceRecordsByTarget.get(target);
      const record = records?.get(sourceId);
      if (!record?.owners.delete(null)) return false;

      if (!record.owners.size) records.delete(sourceId);
      if (!records.size) sourceRecordsByTarget.delete(target);
      return true;
    }

    function sourcesFor(target) {
      return new Set(sourceRecordsByTarget.get(target)?.keys() ?? []);
    }

    function radiusFor(target) {
      const records = sourceRecordsByTarget.get(target);
      if (!records) return 0;
      return Math.max(0, ...[...records.values()].map((record) => record.radius));
    }

    function targetsForSection(section) {
      return new Set(targetSourcesBySection.get(section)?.keys() ?? []);
    }

    function sectionsForTarget(target) {
      return new Set(sectionSourcesByTarget.get(target)?.keys() ?? []);
    }

    function clear() {
      sourceRecordsByTarget = new WeakMap();
      targetSourcesBySection = new WeakMap();
      sectionSourcesByTarget = new WeakMap();
    }

    return Object.freeze({
      addTarget,
      addSectionTarget,
      removeTargetSource,
      removeSectionSource,
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
