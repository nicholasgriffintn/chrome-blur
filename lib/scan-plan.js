(function initialiseBlurScanPlan(global) {
  "use strict";

  function create(profiles = []) {
    const piiProfiles = [];
    const mediaProfiles = [];
    const rules = [];
    const conditionalRules = [];

    for (const profile of profiles) {
      const radius = BlurCore.blurPixels(profile.blurAmount);
      if (profile.blurPii) piiProfiles.push(profile);
      if (profile.blurMedia) {
        mediaProfiles.push({
          profile,
          radius,
          sourceId: `${profile.id}:media`
        });
      }
      for (const rule of profile.rules) {
        if (!rule.enabled) continue;
        const entry = {
          profile,
          rule,
          radius,
          sourceId: `${profile.id}:${rule.id}`
        };
        rules.push(entry);
        if (
          rule.kind === "section"
          && rule.condition === BlurTextConditions.SECTION_CONDITIONS.TRIGGER
        ) {
          conditionalRules.push(entry);
        }
      }
    }

    return Object.freeze({
      piiProfiles: Object.freeze(piiProfiles),
      mediaProfiles: Object.freeze(mediaProfiles),
      rules: Object.freeze(rules),
      conditionalRules: Object.freeze(conditionalRules),
      needsTextObservation: piiProfiles.length > 0 || conditionalRules.length > 0
    });
  }

  global.BlurScanPlan = Object.freeze({ create });
})(globalThis);
