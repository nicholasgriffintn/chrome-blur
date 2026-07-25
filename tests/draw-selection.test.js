const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const drawSelection = loadDrawSelection();

test("normalises a draw made in any direction", () => {
  assert.deepEqual(
    plain(drawSelection.rectangleFromPoints({ x: 240, y: 180 }, { x: 40, y: 60 })),
    {
      left: 40,
      top: 60,
      right: 240,
      bottom: 180,
      width: 200,
      height: 120
    }
  );
});

test("requires a deliberate draw and accepts substantially selected elements", () => {
  assert.equal(drawSelection.isUsableRectangle({ width: 11, height: 40 }), false);
  assert.equal(drawSelection.isUsableRectangle({ width: 80, height: 40 }), true);
  assert.equal(
    drawSelection.isElementInsideDraw(
      rectangle(20, 20, 100, 80),
      rectangle(40, 30, 60, 50)
    ),
    true
  );
  assert.equal(
    drawSelection.isElementInsideDraw(
      rectangle(0, 0, 100, 100),
      rectangle(98, 98, 10, 10)
    ),
    false
  );
});

test("collects the deepest visible content inside the drawn area", () => {
  const card = mockElement("ARTICLE", rectangle(10, 10, 220, 160));
  const heading = mockElement("H2", rectangle(30, 30, 150, 34), card);
  const image = mockElement("IMG", rectangle(30, 80, 100, 70), card);
  const outside = mockElement("P", rectangle(400, 400, 100, 30));
  const root = {
    querySelectorAll() {
      return [card, heading, image, outside];
    }
  };

  assert.deepEqual(
    Array.from(drawSelection.collectElements(root, rectangle(20, 20, 200, 140))),
    [heading, image]
  );
});

function rectangle(left, top, width, height) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function mockElement(tagName, bounds, parentElement = null) {
  return {
    tagName,
    parentElement,
    closest() {
      return null;
    },
    getClientRects() {
      return [bounds];
    },
    getBoundingClientRect() {
      return bounds;
    }
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadDrawSelection() {
  const context = vm.createContext({});
  const source = fs.readFileSync(
    path.join(__dirname, "..", "lib", "draw-selection.js"),
    "utf8"
  );
  vm.runInContext(source, context);
  return context.BlurDrawSelection;
}
