const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const model = loadModel();

test("tracks overlapping default-media and section ownership", () => {
  const registry = model.createRegistry();
  const section = {};
  const image = {};

  registry.addTarget(image, "profile:media", 12);
  registry.addSectionTarget(section, image, "profile:section", 18);

  assert.equal(registry.radiusFor(image), 18);
  assert.deepEqual(Array.from(registry.sourcesFor(image)), ["profile:media", "profile:section"]);
  assert.deepEqual(Array.from(registry.targetsForSection(section)), [image]);
});

test("a revealed section overrides every blur source on its image", () => {
  const registry = model.createRegistry();
  const section = {};
  const image = {};
  const revealedTargets = new WeakSet();
  const revealedSections = new WeakSet();

  registry.addTarget(image, "profile:media", 12);
  registry.addSectionTarget(section, image, "profile:section", 18);
  revealedSections.add(section);

  assert.equal(
    model.isTargetRevealed(registry, image, revealedTargets, revealedSections),
    true
  );
  revealedSections.delete(section);
  assert.equal(
    model.isTargetRevealed(registry, image, revealedTargets, revealedSections),
    false
  );
});

test("recognises CSS background images without treating gradients as media", () => {
  assert.equal(model.isImageBackground('url("hero.jpg")'), true);
  assert.equal(model.isImageBackground('linear-gradient(red, blue), url("hero.jpg")'), true);
  assert.equal(model.isImageBackground("linear-gradient(red, blue)"), false);
  assert.equal(model.isImageBackground("none"), false);
});

test("removes a conditional section source without removing a media default", () => {
  const registry = model.createRegistry();
  const section = {};
  const image = {};

  registry.addTarget(image, "profile:media", 12);
  registry.addSectionTarget(section, image, "profile:conditional", 18);

  assert.deepEqual([...registry.removeSectionSource(section, "profile:conditional")], [image]);
  assert.deepEqual([...registry.sourcesFor(image)], ["profile:media"]);
  assert.equal(registry.radiusFor(image), 12);
  assert.equal(registry.sectionsForTarget(image).size, 0);
});

test("keeps a shared section source while another section still owns it", () => {
  const registry = model.createRegistry();
  const firstSection = {};
  const secondSection = {};
  const image = {};

  registry.addSectionTarget(firstSection, image, "profile:section", 18);
  registry.addSectionTarget(secondSection, image, "profile:section", 18);
  registry.removeSectionSource(firstSection, "profile:section");

  assert.deepEqual([...registry.sourcesFor(image)], ["profile:section"]);
  assert.deepEqual([...registry.sectionsForTarget(image)], [secondSection]);
  assert.equal(registry.radiusFor(image), 18);
});

test("removes one direct source without disturbing other target ownership", () => {
  const registry = model.createRegistry();
  const section = {};
  const field = {};

  registry.addTarget(field, "profile:pii", 12);
  registry.addSectionTarget(section, field, "profile:section", 18);

  assert.equal(registry.removeTargetSource(field, "profile:pii"), true);
  assert.deepEqual([...registry.sourcesFor(field)], ["profile:section"]);
  assert.equal(registry.radiusFor(field), 18);
  assert.equal(registry.removeTargetSource(field, "missing"), false);
});

function loadModel() {
  const context = vm.createContext({});
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "blur-model.js"), "utf8");
  vm.runInContext(source, context);
  return context.BlurModel;
}
