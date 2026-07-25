const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const lifecycle = loadLifecycle();

test("collects newly inserted native media for an immediate blur pass", () => {
  const nestedImage = createElement("img");
  const wrapper = createElement("div", [nestedImage]);
  const video = createElement("video");

  const targets = lifecycle.collectImmediateMediaTargets([
    {
      type: "childList",
      addedNodes: [wrapper, video]
    }
  ]);

  assert.deepEqual([...targets], [nestedImage, video]);
});

test("collects responsive media when its source or classes change", () => {
  const image = createElement("img");

  for (const attributeName of ["class", "src", "srcset", "poster"]) {
    const targets = lifecycle.collectImmediateMediaTargets([
      {
        type: "attributes",
        attributeName,
        target: image,
        addedNodes: []
      }
    ]);

    assert.deepEqual([...targets], [image]);
  }
});

test("deduplicates media that appears in more than one mutation", () => {
  const image = createElement("img");

  const targets = lifecycle.collectImmediateMediaTargets([
    { type: "childList", addedNodes: [image] },
    { type: "attributes", attributeName: "srcset", target: image, addedNodes: [] }
  ]);

  assert.deepEqual([...targets], [image]);
});

test("does not animate between clear and blurred media states", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");

  assert.doesNotMatch(css, /transition\s*:\s*filter/i);
});

test("loads the media lifecycle guard before the content script", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
  );
  const scripts = manifest.content_scripts[0].js;

  assert.ok(scripts.indexOf("lib/media-lifecycle.js") >= 0);
  assert.ok(
    scripts.indexOf("lib/media-lifecycle.js") < scripts.indexOf("content.js")
  );
});

function createElement(tagName, children = []) {
  const element = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    children,
    matches(selector) {
      return selector.split(",").some((part) => part.trim() === tagName);
    },
    querySelectorAll(selector) {
      return descendantsOf(this).filter((child) => child.matches(selector));
    }
  };

  return element;
}

function descendantsOf(element) {
  return element.children.flatMap((child) => [child, ...descendantsOf(child)]);
}

function loadLifecycle() {
  const context = vm.createContext({});
  const source = fs.readFileSync(
    path.join(__dirname, "..", "lib", "media-lifecycle.js"),
    "utf8"
  );
  vm.runInContext(source, context);
  return context.BlurMediaLifecycle;
}
