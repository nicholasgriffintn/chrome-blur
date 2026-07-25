(function initialiseBlurDrawSelection(global) {
  "use strict";

  const EXCLUDED_TAGS = new Set([
    "BODY", "HTML", "SCRIPT", "STYLE", "NOSCRIPT", "TITLE", "META", "LINK"
  ]);
  const MINIMUM_DRAW_SIZE = 12;
  const MINIMUM_OVERLAP = 0.12;

  function rectangleFromPoints(start, end) {
    const left = Math.min(start?.x ?? 0, end?.x ?? 0);
    const top = Math.min(start?.y ?? 0, end?.y ?? 0);
    const right = Math.max(start?.x ?? 0, end?.x ?? 0);
    const bottom = Math.max(start?.y ?? 0, end?.y ?? 0);
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top
    };
  }

  function isUsableRectangle(rectangle) {
    return rectangle?.width >= MINIMUM_DRAW_SIZE && rectangle?.height >= MINIMUM_DRAW_SIZE;
  }

  function rectangleOverlapRatio(elementRectangle, selectionRectangle) {
    const overlapWidth = Math.max(
      0,
      Math.min(elementRectangle.right, selectionRectangle.right) -
        Math.max(elementRectangle.left, selectionRectangle.left)
    );
    const overlapHeight = Math.max(
      0,
      Math.min(elementRectangle.bottom, selectionRectangle.bottom) -
        Math.max(elementRectangle.top, selectionRectangle.top)
    );
    const overlapArea = overlapWidth * overlapHeight;
    const elementArea = elementRectangle.width * elementRectangle.height;
    return elementArea > 0 ? overlapArea / elementArea : 0;
  }

  function isElementInsideDraw(elementRectangle, selectionRectangle) {
    if (!elementRectangle || !selectionRectangle) return false;
    if (elementRectangle.width <= 0 || elementRectangle.height <= 0) return false;

    const centreX = elementRectangle.left + elementRectangle.width / 2;
    const centreY = elementRectangle.top + elementRectangle.height / 2;
    const centreInside = centreX >= selectionRectangle.left &&
      centreX <= selectionRectangle.right &&
      centreY >= selectionRectangle.top &&
      centreY <= selectionRectangle.bottom;
    return centreInside ||
      rectangleOverlapRatio(elementRectangle, selectionRectangle) >= MINIMUM_OVERLAP;
  }

  function collectElements(root, selectionRectangle) {
    if (!root?.querySelectorAll || !isUsableRectangle(selectionRectangle)) return [];

    const selected = [];
    root.querySelectorAll("body *").forEach((element) => {
      if (EXCLUDED_TAGS.has(element.tagName)) return;
      if (element.closest?.("#blur-extension-picker-host, #blur-extension-ui-host")) return;
      if (!element.getClientRects?.().length) return;
      if (!isElementInsideDraw(element.getBoundingClientRect(), selectionRectangle)) return;
      selected.push(element);
    });

    return deepestSelectedElements(selected);
  }

  function deepestSelectedElements(elements) {
    const selected = new Set(elements);
    const selectedAncestors = new Set();

    elements.forEach((element) => {
      let ancestor = element.parentElement;
      while (ancestor) {
        if (selected.has(ancestor)) selectedAncestors.add(ancestor);
        ancestor = ancestor.parentElement;
      }
    });
    return elements.filter((element) => !selectedAncestors.has(element));
  }

  global.BlurDrawSelection = Object.freeze({
    collectElements,
    isElementInsideDraw,
    isUsableRectangle,
    rectangleFromPoints
  });
})(globalThis);
