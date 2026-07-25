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
