const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const NodeFilter = Object.freeze({
  SHOW_TEXT: 4,
  FILTER_ACCEPT: 1,
  FILTER_REJECT: 2
});
const piiDom = loadPiiDom();

test("wraps only the sensitive part of a text node and reports the fragment", () => {
  const fixture = createFixture("Contact jane@example.com now");
  const fragments = [];

  piiDom.apply(fixture.root, {
    onFragment(fragment) {
      fragments.push(fragment);
    }
  });

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].className, piiDom.FRAGMENT_CLASS);
  assert.equal(fragments[0].dataset.blurPiiType, "email");
  assert.deepEqual(
    fixture.parent.children.map((node) => node.textContent),
    ["Contact ", "jane@example.com", " now"]
  );
});

test("unwraps generated fragments without changing page text", () => {
  const fixture = createFixture("Email jane@example.com");
  piiDom.apply(fixture.root);

  piiDom.clear(fixture.root);

  assert.equal(fixture.parent.children.map((node) => node.textContent).join(""), fixture.text);
  assert.equal(fixture.root.querySelectorAll(`.${piiDom.FRAGMENT_CLASS}`).length, 0);
});

test("marks static values from generic field labels without marking their labels", () => {
  const documentContext = new FakeDocument();
  const root = new FakeElement("main", documentContext);
  const fixtures = [
    ["display-name-field", "Display name", "Alex Example", "name"],
    ["gender-field", "Gender", "Non-binary", "demographic"],
    ["year-of-birth-field", "Year of birth", "1990", "birth-date"],
    ["postal-address-field", "Home address", "42 Example Road", "address"]
  ];
  const values = fixtures.map(([id, label, value]) => {
    const field = new FakeElement("div", documentContext, { id, className: "profile-field" });
    const container = new FakeElement("div", documentContext, { className: "field-content" });
    const valueElement = new FakeElement("div", documentContext, { className: "field-value" });
    const labelElement = new FakeElement("div", documentContext, { className: "field-label" });
    valueElement.append(new FakeText(value, valueElement));
    labelElement.append(new FakeText(label, labelElement));
    container.append(valueElement);
    container.append(labelElement);
    field.append(container);
    root.append(field);
    return valueElement;
  });
  const detected = [];

  piiDom.apply(root, {
    onStaticValue(element, type) {
      detected.push({ element, type });
    }
  });

  assert.deepEqual(detected.map(({ type }) => type), fixtures.map((fixture) => fixture[3]));
  assert.deepEqual(detected.map(({ element }) => element), values);
  assert.equal(root.querySelectorAll(".field-label").some((label) =>
    label.classList.contains(piiDom.STATIC_VALUE_CLASS)
  ), false);
});

test("ignores nearby actions and non-sensitive labelled values", () => {
  const documentContext = new FakeDocument();
  const root = new FakeElement("main", documentContext);
  const field = new FakeElement("div", documentContext, { id: "preference-field" });
  const container = new FakeElement("div", documentContext, {
    className: "field__input-container"
  });
  const value = new FakeElement("div", documentContext, { className: "field__input" });
  const label = new FakeElement("div", documentContext, { className: "field__label" });
  const action = new FakeElement("a", documentContext, { className: "account-detail" });
  value.append(new FakeText("Blue", value));
  label.append(new FakeText("Favourite colour", label));
  action.append(new FakeText("Delete your account", action));
  container.append(value);
  container.append(label);
  field.append(container);
  root.append(field);
  root.append(action);
  const detected = [];

  piiDom.apply(root, {
    onStaticValue(element) {
      detected.push(element);
    }
  });

  assert.deepEqual(detected, []);
  assert.equal(container.classList.contains(piiDom.STATIC_VALUE_CLASS), false);
  assert.equal(value.classList.contains(piiDom.STATIC_VALUE_CLASS), false);
});

test("reports sensitive contenteditable regions as field-like values", () => {
  const documentContext = new FakeDocument();
  const root = new FakeElement("main", documentContext);
  const editor = new FakeElement("div", documentContext, {
    attributes: { contenteditable: "true", "aria-label": "Security answer" }
  });
  editor.append(new FakeText("Example phrase", editor));
  root.append(editor);
  const fields = [];

  piiDom.apply(root, {
    onField(field) {
      fields.push(field);
    }
  });

  assert.deepEqual(fields, [editor]);
});

function createFixture(text) {
  const documentContext = new FakeDocument();
  const root = new FakeElement("main", documentContext);
  const parent = new FakeElement("p", documentContext);
  const textNode = new FakeText(text, parent);
  parent.children.push(textNode);
  root.children.push(parent);
  parent.parentElement = root;
  return { documentContext, parent, root, text };
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  createTreeWalker(root, _show, filter) {
    const textNodes = descendantsOf(root).filter((node) => node.nodeType === 3);
    let index = -1;
    return {
      currentNode: null,
      nextNode() {
        while (++index < textNodes.length) {
          if (filter.acceptNode(textNodes[index]) !== NodeFilter.FILTER_ACCEPT) continue;
          this.currentNode = textNodes[index];
          return true;
        }
        return false;
      }
    };
  }
}

class FakeElement {
  constructor(tagName, ownerDocument, options = {}) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.namespaceURI = "http://www.w3.org/1999/xhtml";
    this.parentElement = null;
    this.children = [];
    this.childNodes = this.children;
    this.className = options.className ?? "";
    this.id = options.id ?? "";
    this.dataset = {};
    this.attributes = { ...options.attributes };
    this.classList = {
      add: (...names) => {
        const classes = new Set(this.className.split(/\s+/u).filter(Boolean));
        names.forEach((name) => classes.add(name));
        this.className = [...classes].join(" ");
      },
      remove: (...names) => {
        const removed = new Set(names);
        this.className = this.className
          .split(/\s+/u)
          .filter((name) => name && !removed.has(name))
          .join(" ");
      },
      contains: (name) => this.className.split(/\s+/u).includes(name)
    };
  }

  get textContent() {
    return this.children.map((child) => child.textContent).join("");
  }

  get parentNode() {
    return this.parentElement;
  }

  matches(selector) {
    return selector.split(",").some((part) => matchesSelectorPart(this, part.trim()));
  }

  closest(selector) {
    if (this.matches(selector)) return this;
    return this.parentElement?.closest(selector) ?? null;
  }

  querySelectorAll(selector) {
    return descendantsOf(this).filter((node) => node.nodeType === 1 && node.matches(selector));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  getAttribute(name) {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    return this.attributes[name] ?? null;
  }

  insertBefore(node, reference) {
    detach(node);
    const index = this.children.indexOf(reference);
    this.children.splice(index, 0, node);
    node.parentElement = this;
  }

  append(node) {
    detach(node);
    this.children.push(node);
    node.parentElement = this;
  }

  replaceWith(...nodes) {
    const parent = this.parentElement;
    const index = parent.children.indexOf(this);
    parent.children.splice(index, 1, ...nodes);
    nodes.forEach((node) => {
      node.parentElement = parent;
    });
    this.parentElement = null;
  }
}

class FakeText {
  constructor(data, parentElement) {
    this.nodeType = 3;
    this.data = data;
    this.parentElement = parentElement;
  }

  get textContent() {
    return this.data;
  }

  get parentNode() {
    return this.parentElement;
  }

  splitText(offset) {
    const remainder = new FakeText(this.data.slice(offset), this.parentElement);
    this.data = this.data.slice(0, offset);
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this) + 1, 0, remainder);
    return remainder;
  }
}

function descendantsOf(element) {
  return element.children.flatMap((child) => [
    child,
    ...(child.nodeType === 1 ? descendantsOf(child) : [])
  ]);
}

function detach(node) {
  if (!node.parentElement) return;
  const siblings = node.parentElement.children;
  const index = siblings.indexOf(node);
  if (index >= 0) siblings.splice(index, 1);
}

function matchesSelectorPart(element, selector) {
  if (!selector) return false;
  if (/^[a-z]+$/iu.test(selector)) return element.tagName.toLowerCase() === selector.toLowerCase();
  if (selector.startsWith(".")) return element.classList.contains(selector.slice(1));
  if (selector === "[itemprop]") return Boolean(element.getAttribute("itemprop"));
  if (selector === "[data-label]") return Boolean(element.getAttribute("data-label"));
  if (selector === "[aria-label]") return Boolean(element.getAttribute("aria-label"));
  if (selector === '[contenteditable]:not([contenteditable="false"])') {
    const value = element.getAttribute("contenteditable");
    return value !== null && value !== "false";
  }

  const classContains = selector.match(/^\[class\*="([^"]+)" i\]$/u);
  if (classContains) return element.className.toLowerCase().includes(classContains[1].toLowerCase());
  return false;
}

function loadPiiDom() {
  const context = vm.createContext({ NodeFilter });
  for (const relativePath of ["lib/pii-detector.js", "lib/pii-dom.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
    vm.runInContext(source, context);
  }
  return context.BlurPiiDom;
}
