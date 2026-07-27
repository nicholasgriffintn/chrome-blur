const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");

test("popup exposes trigger terms, presets and a per-section condition", () => {
  const popup = read("popup.html");

  assert.match(popup, /id="blur-pii"/);
  assert.match(popup, /id="trigger-words"/);
  assert.match(popup, /id="context-words"/);
  assert.match(popup, /data-trigger-preset="spoilers"/);
  assert.match(popup, /data-trigger-preset="violence"/);
  assert.match(popup, /data-trigger-preset="results"/);
  assert.match(popup, /class="rule-condition"/);
  assert.match(popup, /value="always"/);
  assert.match(popup, /value="trigger"/);
  assert.match(popup, /aria-pressed="false"/);
});

test("changing a section condition persists immediately", () => {
  const popup = read("popup.js");
  const conditionHandler = popup.match(
    /condition\.addEventListener\("change",[\s\S]*?(?=row\.querySelector\("\.rule-delete"\))/
  )?.[0] ?? "";

  assert.match(conditionHandler, /clearTimeout\(saveTimer\)/);
  assert.match(conditionHandler, /save\(\)\.catch\(showError\)/);
  assert.doesNotMatch(conditionHandler, /queueSave\(\)/);
});

test("the content script loads local PII detection before page processing", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const scripts = manifest.content_scripts[0].js;

  assert.ok(scripts.indexOf("lib/pii-detector.js") >= 0);
  assert.ok(scripts.indexOf("lib/pii-dom.js") > scripts.indexOf("lib/pii-detector.js"));
  assert.ok(scripts.indexOf("lib/pii-dom.js") < scripts.indexOf("content.js"));
  assert.ok(scripts.indexOf("lib/pii-detector.js") < scripts.indexOf("content.js"));
});

test("section picking exposes draw mode and loads its local geometry helper", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const scripts = manifest.content_scripts[0].js;
  const content = read("content.js");

  assert.ok(scripts.indexOf("lib/draw-selection.js") > scripts.indexOf("lib/selectors.js"));
  assert.ok(scripts.indexOf("lib/draw-selection.js") < scripts.indexOf("content.js"));
  assert.ok(scripts.indexOf("lib/section-targets.js") > scripts.indexOf("lib/draw-selection.js"));
  assert.ok(scripts.indexOf("lib/section-targets.js") < scripts.indexOf("content.js"));
  assert.match(content, /drawButton\.textContent = "Draw area"/);
  assert.match(content, /Drag around the content that belongs in one section/);
  assert.match(content, /findSectionCandidateFromElements/);
  assert.match(content, /buildRelativeSelectors/);
  assert.match(content, /BlurSectionTargets\.resolve/);
  assert.match(content, /broadSectionRule\.targetSelectors = targetSelectors/);
  assert.match(content, /commitPickerCandidate/);
});

test("sensitive inputs have a dedicated blur rule that can outrank page field styles", () => {
  const css = read("content.css");

  assert.match(css, /input\.blur-extension-pii-field/);
  assert.match(css, /textarea\.blur-extension-pii-field/);
  assert.match(css, /\[contenteditable\]\.blur-extension-pii-field/);
  assert.match(css, /input\.blur-extension-pii-field\.blur-extension-revealed/);
  assert.match(css, /filter:\s*blur\(var\(--blur-extension-radius\)\)\s*!important/);
});

test("heavy page monitoring only runs while a profile matches", () => {
  const content = read("content.js");

  assert.match(content, /let pageFeaturesActive = false/);
  assert.match(content, /function syncPageFeatures/);
  assert.match(content, /function activatePageFeatures/);
  assert.match(content, /function deactivatePageFeatures/);
  assert.match(content, /observer[?][.]disconnect/);
});

test("reapplying rules clears reveal exceptions and supports keyboard reveal", () => {
  const content = read("content.js");

  assert.match(content, /revealedTargets = new WeakSet/);
  assert.match(content, /function resetRevealState/);
  assert.match(content, /function handleRevealKeydown/);
  assert.match(content, /event[.]altKey/);
});

test("matching pages periodically refresh only tracked script-populated sensitive fields", () => {
  const content = read("content.js");

  assert.match(content, /function configurePiiRefresh/);
  assert.match(content, /setInterval[(]refreshPiiFields, 2000[)]/);
  assert.match(content, /trackedPiiFields/);
  assert.doesNotMatch(
    content.match(/function refreshPiiFields\(\)[\s\S]*?(?=\n  function )/)?.[0] ?? "",
    /document[.]querySelectorAll/
  );
});

test("mutation scans use one compiled plan and skip work completed by immediate guards", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const content = read("content.js");
  const scripts = manifest.content_scripts[0].js;

  assert.ok(scripts.indexOf("lib/scan-plan.js") < scripts.indexOf("content.js"));
  assert.match(content, /BlurScanPlan[.]create/);
  assert.match(content, /skipPii:\s*true/);
  assert.match(content, /skipConditional:\s*true/);
  assert.match(content, /skipNativeMedia:\s*true/);
});

test("popup reports invalid site patterns next to the editor", () => {
  const popup = read("popup.html");
  const script = read("popup.js");

  assert.match(popup, /id="site-pattern-error"/);
  assert.match(script, /BlurCore[.]getPatternError/);
});

test("popup can back up and restore all local profiles", () => {
  const popup = read("popup.html");
  const script = read("popup.js");

  assert.match(popup, /id="export-settings"/);
  assert.match(popup, /id="import-settings"/);
  assert.match(script, /function exportSettings/);
  assert.match(script, /async function importSettings/);
  assert.match(script, /replace all current Blur profiles/);
});

test("every extension context loads text conditions before profile state", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const scripts = manifest.content_scripts[0].js;
  const popup = read("popup.html");
  const serviceWorker = read("service-worker.js");

  assert.ok(scripts.indexOf("lib/text-conditions.js") < scripts.indexOf("lib/state.js"));
  assert.ok(popup.indexOf('src="lib/text-conditions.js"') < popup.indexOf('src="lib/state.js"'));
  assert.match(
    serviceWorker,
    /importScripts\("lib\/text-conditions\.js", "lib\/state\.js"\)/
  );
});

test("the filter summary owns and contains its circular boundary", () => {
  const css = read("popup.css");
  const countRule = css.match(/#trigger-count\s*\{([^}]+)\}/)?.[1] ?? "";

  assert.doesNotMatch(css, /\.trigger-panel::before/);
  assert.match(countRule, /display:\s*grid/);
  assert.match(countRule, /place-items:\s*center/);
  assert.match(countRule, /border-radius:\s*50%/);
  assert.match(countRule, /overflow-wrap:\s*anywhere/);
  assert.match(countRule, /text-align:\s*center/);
});

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}
