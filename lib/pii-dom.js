(function initialiseBlurPiiDom(global) {
  "use strict";

  const FRAGMENT_CLASS = "blur-extension-pii-fragment";
  const FIELD_CLASS = "blur-extension-pii-field";
  const STATIC_VALUE_CLASS = "blur-extension-pii-static-value";
  const FIELD_SELECTOR = [
    "input",
    "textarea",
    "[contenteditable]:not([contenteditable=\"false\"])"
  ].join(", ");
  const STATIC_VALUE_SELECTOR = [
    "dd",
    "td",
    "[itemprop]",
    "[class*=\"value\" i]",
    "[class*=\"input\" i]",
    "[class*=\"answer\" i]",
    "[class*=\"detail\" i]"
  ].join(", ");
  const LABEL_SELECTOR = [
    "label",
    "dt",
    "th",
    "[class*=\"label\" i]",
    "[data-label]",
    "[aria-label]"
  ].join(", ");
  const INTERACTIVE_SELECTOR = "input, textarea, select, button, a";
  const MAX_CONTEXT_DEPTH = 3;
  const EXCLUDED_TEXT_PARENTS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TITLE", "TEXTAREA", "INPUT",
    "SELECT", "OPTION", "BUTTON"
  ]);

  function apply(root, handlers = {}) {
    if (!root) return;

    findWithin(root, `.${FRAGMENT_CLASS}`).forEach((fragment) => {
      handlers.onFragment?.(fragment);
    });
    findWithin(root, `.${STATIC_VALUE_CLASS}`).forEach((element) => {
      handlers.onStaticValue?.(element, element.dataset.blurPiiType);
    });
    findWithin(root, FIELD_SELECTOR).forEach((field) => {
      handlers.onField?.(field);
    });
    const containingField = root.nodeType === 1 ? root.closest?.(FIELD_SELECTOR) : null;
    if (containingField && containingField !== root) handlers.onField?.(containingField);
    findWithin(root, STATIC_VALUE_SELECTOR).forEach((element) => {
      if (element.classList.contains(STATIC_VALUE_CLASS)) return;
      const type = staticValueType(element);
      if (!type) return;
      element.classList.add(STATIC_VALUE_CLASS);
      element.dataset.blurPiiType = type;
      handlers.onStaticValue?.(element, type);
    });

    const documentContext = root.ownerDocument ?? root;
    const walker = documentContext.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!node.textContent?.trim() || !parent) return NodeFilter.FILTER_REJECT;
        if (
          EXCLUDED_TEXT_PARENTS.has(parent.tagName) ||
          parent.namespaceURI !== "http://www.w3.org/1999/xhtml"
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        if (
          parent.closest(
            `.${FRAGMENT_CLASS}, .${STATIC_VALUE_CLASS}, [contenteditable="true"], ` +
              "#blur-extension-ui-host, #blur-extension-picker-host"
          )
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((textNode) => {
      wrapSensitiveText(documentContext, textNode, handlers.onFragment);
    });
  }

  function clear(root) {
    findWithin(root, `.${FRAGMENT_CLASS}`).forEach((fragment) => {
      fragment.replaceWith(...fragment.childNodes);
    });
    findWithin(root, `.${STATIC_VALUE_CLASS}`).forEach((element) => {
      element.classList.remove(STATIC_VALUE_CLASS);
      delete element.dataset.blurPiiType;
    });
  }

  function staticValueType(element) {
    if (!isStaticValueCandidate(element)) return null;

    let scope = element;
    for (let depth = 0; scope && depth <= MAX_CONTEXT_DEPTH; depth += 1) {
      const metadataType = BlurPiiDetector.sensitiveSemanticType(elementMetadata(scope));
      if (metadataType) return metadataType;

      const labelType = BlurPiiDetector.sensitiveSemanticType(labelTextNear(element, scope));
      if (labelType) return labelType;
      scope = scope.parentElement;
    }
    return null;
  }

  function isStaticValueCandidate(element) {
    if (!element.textContent?.trim()) return false;
    if (element.matches(`${INTERACTIVE_SELECTOR}, label`)) return false;
    if (element.querySelector?.(INTERACTIVE_SELECTOR)) return false;

    if (["DD", "TD"].includes(element.tagName)) return true;
    if (
      element.getAttribute("itemprop") &&
      BlurPiiDetector.sensitiveSemanticType(element.getAttribute("itemprop"))
    ) {
      return true;
    }

    return String(element.className ?? "")
      .split(/\s+/u)
      .some(isStaticValueClass);
  }

  function isStaticValueClass(className) {
    const words = className.toLowerCase().split(/(?:__|--|[-_])/u).filter(Boolean);
    if (!words.some((word) => ["value", "input", "answer", "detail"].includes(word))) {
      return false;
    }
    return !words.some((word) =>
      ["button", "container", "control", "decoration", "group", "label", "link", "wrapper"]
        .includes(word)
    );
  }

  function elementMetadata(element) {
    return [
      BlurPiiDetector.getFieldSemanticHint(element),
      element.getAttribute?.("id"),
      element.getAttribute?.("class"),
      element.getAttribute?.("itemprop"),
      element.getAttribute?.("name"),
      element.getAttribute?.("data-testid"),
      element.getAttribute?.("data-label"),
      element.getAttribute?.("aria-label")
    ].filter(Boolean).join(" ");
  }

  function labelTextNear(element, scope) {
    const previous = element.previousElementSibling;
    const previousText = previous?.matches?.(LABEL_SELECTOR) ? previous.textContent : "";
    const labels = scope.querySelectorAll?.(LABEL_SELECTOR) ?? [];
    return [previousText, ...labels].map((label) =>
      typeof label === "string" ? label : label.textContent
    ).filter(Boolean).join(" ");
  }

  function wrapSensitiveText(documentContext, textNode, onFragment) {
    const ranges = BlurPiiDetector.findSensitiveRanges(textNode.data);

    for (let index = ranges.length - 1; index >= 0; index -= 1) {
      const range = ranges[index];
      textNode.splitText(range.end);
      const sensitiveNode = textNode.splitText(range.start);
      const fragment = documentContext.createElement("span");
      fragment.className = FRAGMENT_CLASS;
      fragment.dataset.blurPiiType = range.type;
      sensitiveNode.parentNode?.insertBefore(fragment, sensitiveNode);
      fragment.append(sensitiveNode);
      onFragment?.(fragment);
    }
  }

  function findWithin(root, selector) {
    const matches = root.nodeType === 1 && root.matches?.(selector) ? [root] : [];
    return matches.concat([...(root.querySelectorAll?.(selector) ?? [])]);
  }

  global.BlurPiiDom = Object.freeze({
    FIELD_CLASS,
    FIELD_SELECTOR,
    FRAGMENT_CLASS,
    STATIC_VALUE_CLASS,
    apply,
    clear
  });
})(globalThis);
