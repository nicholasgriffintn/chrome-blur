const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sectionTargets = loadSectionTargets();

test("normal sections still resolve to their whole wrapper", () => {
  const row = mockNode();

  assert.deepEqual(Array.from(sectionTargets.resolve(row, [])), [row]);
});

test("drawn sections resolve only the stored targets inside each repeated wrapper", () => {
  const image = mockNode();
  const title = mockNode();
  const publishedDate = mockNode();
  const row = mockNode({
    selectors: {
      ":scope > img.cover": [image],
      ":scope > div.copy > h2": [title]
    },
    children: [image, title, publishedDate]
  });

  assert.deepEqual(
    Array.from(sectionTargets.resolve(
      row,
      [":scope > img.cover", ":scope > div.copy > h2"]
    )),
    [image, title]
  );
  assert.equal(
    sectionTargets.contains(
      row,
      publishedDate,
      [":scope > img.cover", ":scope > div.copy > h2"]
    ),
    false
  );
});

test("drawn section conditions ignore text outside the stored targets", () => {
  const image = mockNode({ textContent: "Article image" });
  const title = mockNode({ textContent: "Five ways to enjoy the summer holidays" });
  const metrics = mockNode({ textContent: "Engaged 0:53 · Age 16-24" });
  const selectors = [":scope > img.cover", ":scope > div.copy > h2"];
  const row = mockNode({
    selectors: {
      [selectors[0]]: [image],
      [selectors[1]]: [title]
    },
    children: [image, title, metrics]
  });

  assert.equal(
    sectionTargets.some(row, selectors, (target) => target.textContent.includes("0:53")),
    false
  );
  assert.equal(
    sectionTargets.some(row, selectors, (target) => target.textContent.includes("summer")),
    true
  );
});

function mockNode({ selectors = {}, children = [], textContent = "" } = {}) {
  const node = {
    textContent,
    querySelectorAll(selector) {
      return selectors[selector] ?? [];
    },
    contains(candidate) {
      return candidate === node || children.includes(candidate);
    }
  };
  return node;
}

function loadSectionTargets() {
  const context = vm.createContext({});
  const source = fs.readFileSync(
    path.join(__dirname, "..", "lib", "section-targets.js"),
    "utf8"
  );
  vm.runInContext(source, context);
  return context.BlurSectionTargets;
}
