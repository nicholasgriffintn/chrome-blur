const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class MockElement {
  constructor({
    localName = "div",
    id = "",
    classes = [],
    text = "",
    parent = null,
    attributes = {}
  } = {}) {
    this.localName = localName;
    this.tagName = localName.toUpperCase();
    this.id = id;
    this.classList = classes;
    this.textContent = text;
    this.parentElement = parent;
    this.attributes = attributes;
    this.children = [];
    if (parent) parent.children.push(this);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  getAttributeNames() {
    return Object.keys(this.attributes);
  }

  querySelector(selector) {
    const tags = selector.match(/\b(?:img|picture|video)\b/g) ?? [];
    const roleImage = selector.includes("[role='img']");
    const queue = [...this.children];
    while (queue.length) {
      const child = queue.shift();
      if (tags.includes(child.localName) || (roleImage && child.getAttribute("role") === "img")) return child;
      queue.push(...child.children);
    }
    return null;
  }
}

const selectors = loadSelectors();

test("prefers a unique escaped ID", () => {
  const element = new MockElement({ id: "private:balance" });
  const root = {
    documentElement: {},
    querySelectorAll(selector) {
      return selector === "#private\\:balance" ? [element] : [];
    }
  };

  assert.equal(selectors.buildSelector(element, root), "#private\\:balance");
});

test("drops extension and hash-like classes from generated selectors", () => {
  const element = new MockElement({
    localName: "h2",
    classes: ["blur-extension-target", "a4f3d91c", "headline", "featured"]
  });
  const root = {
    documentElement: {},
    querySelectorAll(selector) {
      return selector === "h2.headline.featured" ? [element] : [];
    }
  };

  assert.equal(selectors.buildSelector(element, root), "h2.headline.featured");
});

test("creates a concise label without storing selected page text", () => {
  const element = new MockElement({
    localName: "article",
    classes: ["story-card"],
    text: "  A private headline with    irregular spacing  "
  });

  assert.equal(
    selectors.describeElement(element),
    "article.story-card"
  );
});

test("recognises unstable implementation classes", () => {
  assert.equal(selectors.isStableClass("blur-extension-target"), false);
  assert.equal(selectors.isStableClass("a4f3d91c"), false);
  assert.equal(selectors.isStableClass("sitecss-6bmydz-Headline"), false);
  assert.equal(selectors.isStableClass("e1vyq2e80"), false);
  assert.equal(selectors.isStableClass("headline"), true);
});

test("infers a repeated card container from a nested headline", () => {
  const promo = new MockElement({
    classes: ["sitecss-ccqz3i-Card", "e1vyq2e80"],
    attributes: { "data-testid": "promo" }
  });
  const content = new MockElement({ parent: promo });
  const link = new MockElement({ localName: "a", parent: content });
  const headline = new MockElement({ localName: "h2", parent: link });
  new MockElement({ localName: "img", parent: promo });
  const anotherPromo = new MockElement({
    classes: ["sitecss-ccqz3i-Card", "e1vyq2e80"],
    attributes: { "data-testid": "promo" }
  });
  const root = {
    documentElement: {},
    querySelectorAll(selector) {
      return selector === 'div[data-testid="promo"]' ? [promo, anotherPromo] : [];
    }
  };

  assert.equal(selectors.findSectionCandidate(headline, root), promo);
});

test("uses stable data landmarks in selector labels", () => {
  const promo = new MockElement({
    attributes: { "data-testid": "promo" },
    classes: ["sitecss-ccqz3i-Card"]
  });

  assert.equal(selectors.describeElement(promo), 'div[data-testid="promo"]');
});

test("section selectors target every card sharing the stable landmark", () => {
  const section = new MockElement({ localName: "section" });
  const promo = new MockElement({
    parent: section,
    attributes: { "data-testid": "promo" },
    classes: ["sitecss-ccqz3i-Card"]
  });
  const anotherPromo = new MockElement({
    parent: section,
    attributes: { "data-testid": "promo" },
    classes: ["sitecss-ccqz3i-Card"]
  });
  const root = {
    documentElement: {},
    querySelectorAll(selector) {
      if (selector === 'div[data-testid="promo"]') return [promo, anotherPromo];
      if (selector.includes("section")) return [promo];
      return [];
    }
  };

  assert.equal(
    selectors.buildSelector(promo, root, { matchGroup: true }),
    'div[data-testid="promo"]'
  );
});

test("section selectors prefer a shared card class over a unique data ID", () => {
  const card = new MockElement({
    localName: "article",
    attributes: { "data-testid": "story-42" },
    classes: ["story-card"]
  });
  const anotherCard = new MockElement({
    localName: "article",
    attributes: { "data-testid": "story-73" },
    classes: ["story-card"]
  });
  const root = {
    documentElement: {},
    querySelectorAll(selector) {
      if (selector === 'article[data-testid="story-42"]') return [card];
      if (selector === "article.story-card") return [card, anotherCard];
      return [];
    }
  };

  assert.equal(
    selectors.buildSelector(card, root, { matchGroup: true }),
    "article.story-card"
  );
});

test("section selectors infer repeated components from a shared parent structure", () => {
  const grid = new MockElement({ classes: ["results-grid"] });
  const card = new MockElement({ parent: grid });
  const anotherCard = new MockElement({ parent: grid });
  const root = {
    documentElement: {},
    querySelectorAll(selector) {
      return selector === "div.results-grid > div" ? [card, anotherCard] : [];
    }
  };

  assert.equal(
    selectors.buildSelector(card, root, { matchGroup: true }),
    "div.results-grid > div"
  );
});

test("drawn content resolves to one shared card and keeps its repeated selector", () => {
  const grid = new MockElement({ classes: ["story-grid"] });
  const card = new MockElement({ localName: "article", classes: ["story-card"], parent: grid });
  const heading = new MockElement({ localName: "h2", parent: card });
  const image = new MockElement({ localName: "img", parent: card });
  const anotherCard = new MockElement({
    localName: "article",
    classes: ["story-card"],
    parent: grid
  });
  const root = {
    documentElement: {},
    querySelectorAll(selector) {
      return selector === "article.story-card" ? [card, anotherCard] : [];
    }
  };

  const candidate = selectors.findSectionCandidateFromElements([heading, image], root);

  assert.equal(candidate, card);
  assert.equal(
    selectors.buildSelector(candidate, root, { matchGroup: true }),
    "article.story-card"
  );
});

test("drawn content keeps precise paths inside the repeated wrapper", () => {
  const card = new MockElement({ classes: ["result-row"] });
  const image = new MockElement({ localName: "img", classes: ["cover"], parent: card });
  const copy = new MockElement({ classes: ["copy"], parent: card });
  const title = new MockElement({ localName: "h2", parent: copy });
  new MockElement({ classes: ["published-date"], parent: card });

  assert.deepEqual(
    Array.from(selectors.buildRelativeSelectors(card, [image, title])),
    [":scope > img.cover", ":scope > div.copy > h2"]
  );
});

function loadSelectors() {
  const context = vm.createContext({
    Element: MockElement,
    CSS: {
      escape(value) {
        return String(value).replace(":", "\\:");
      }
    }
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "selectors.js"), "utf8");
  vm.runInContext(source, context);
  return context.BlurSelectors;
}
