const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({
  BlurCore: { blurPixels: (amount) => amount / 10 },
  BlurTextConditions: {
    SECTION_CONDITIONS: {
      TRIGGER: "trigger"
    }
  }
});
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "lib", "scan-plan.js"), "utf8"),
  context
);

test("compiles profile work once for repeated DOM scans", () => {
  const profile = {
    id: "work",
    blurAmount: 60,
    blurPii: true,
    blurMedia: true,
    rules: [
      { id: "headline", enabled: true, kind: "element", condition: "always" },
      { id: "section", enabled: true, kind: "section", condition: "trigger" },
      { id: "disabled", enabled: false, kind: "element", condition: "always" }
    ]
  };

  const plan = context.BlurScanPlan.create([profile]);

  assert.deepEqual(Array.from(plan.piiProfiles), [profile]);
  assert.equal(plan.mediaProfiles[0].radius, 6);
  assert.equal(plan.mediaProfiles[0].sourceId, "work:media");
  assert.deepEqual(Array.from(plan.rules, ({ sourceId }) => sourceId), [
    "work:headline",
    "work:section"
  ]);
  assert.deepEqual(Array.from(plan.conditionalRules, ({ sourceId }) => sourceId), [
    "work:section"
  ]);
  assert.equal(plan.needsTextObservation, true);
});
