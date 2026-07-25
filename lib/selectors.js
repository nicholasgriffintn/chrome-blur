(function initialiseBlurSelectors(global) {
  "use strict";

  const MAX_PATH_DEPTH = 10;
  const SECTION_ROLES = new Set(["article", "listitem"]);
  const SECTION_CONTAINER_TAGS = new Set(["ARTICLE", "ASIDE", "DIV", "LI", "SECTION"]);
  const SECTION_EXCLUDED_TAGS = new Set(["BODY", "FOOTER", "HEADER", "HTML", "MAIN", "NAV"]);

  function buildSelector(element, root = document, options = {}) {
    if (!(element instanceof Element)) return "";

    if (options.matchGroup) {
      const group = bestRepeatedSelector(element, root);
      if (group) return group.selector;
    }

    if (element.id) {
      const idSelector = `#${CSS.escape(element.id)}`;
      if (isUnique(idSelector, root)) return idSelector;
    }

    const directSelector = selectorForElement(element);
    if (isUnique(directSelector, root)) return directSelector;

    const path = [];
    let current = element;
    while (current && current !== root.documentElement && path.length < MAX_PATH_DEPTH) {
      path.unshift(selectorForElement(current, true));
      const candidate = path.join(" > ");
      if (isUnique(candidate, root)) return candidate;
      current = current.parentElement;
    }

    return path.join(" > ");
  }

  function selectorForElement(element, includePosition = false) {
    const tag = element.localName;
    const attribute = stableAttributeSelector(element);
    const classes = attribute
      ? ""
      : [...element.classList]
        .filter(isStableClass)
        .slice(0, 3)
        .map((className) => `.${CSS.escape(className)}`)
        .join("");
    const selector = `${tag}${attribute || classes}`;

    if (!includePosition || !element.parentElement?.children) return selector;

    const siblings = [...element.parentElement.children].filter((sibling) => sibling.localName === tag);
    const selectorMatchesMultipleSiblings = siblings
      .filter((sibling) => selectorForElement(sibling) === selector)
      .length > 1;
    return selectorMatchesMultipleSiblings
      ? `${selector}:nth-of-type(${siblings.indexOf(element) + 1})`
      : selector;
  }

  function isStableClass(className) {
    if (!className || className.startsWith("blur-extension-")) return false;
    if (className.length > 64) return false;
    if (/^[a-f\d]{8,}$/i.test(className)) return false;
    if (/^(?:[a-z]*css|sc)-[a-z\d]+(?:-|$)/i.test(className)) return false;
    if (/^e[a-z]*\d[a-z\d]{5,}$/i.test(className)) return false;
    return true;
  }

  function isUnique(selector, root) {
    try {
      return root.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function countMatches(selector, root) {
    try {
      return root.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  }

  function describeElement(element) {
    if (!(element instanceof Element)) return "Selected element";

    const attribute = attributeSelectorsForElement(element)[0]?.suffix ?? "";
    const identity = element.id
      ? `#${element.id}`
      : attribute || [...element.classList].filter(isStableClass).slice(0, 2).map((name) => `.${name}`).join("");
    return `${element.localName}${identity}`.slice(0, 80);
  }

  function findSectionCandidate(element, root = document) {
    if (!(element instanceof Element)) return element;

    let current = element.parentElement ?? element;
    let bestCandidate = null;
    for (let depth = 0; current && depth < MAX_PATH_DEPTH; depth += 1) {
      if (SECTION_EXCLUDED_TAGS.has(current.tagName)) break;

      const repeatedSelector = bestRepeatedSelector(current, root);
      if (repeatedSelector) {
        const score = scoreSectionCandidate(current, repeatedSelector.count, depth);
        if (!bestCandidate || score > bestCandidate.score) {
          bestCandidate = { element: current, score };
        }
      }
      current = current.parentElement;
    }

    return bestCandidate?.element ?? element.parentElement ?? element;
  }

  function findSectionCandidateFromElements(elements, root = document) {
    const selectedElements = [...new Set(elements)].filter((element) => element instanceof Element);
    if (!selectedElements.length) return null;

    const commonAncestor = lowestCommonAncestor(selectedElements);
    if (!commonAncestor || SECTION_EXCLUDED_TAGS.has(commonAncestor.tagName)) return null;

    let current = commonAncestor;
    let fallback = null;
    let bestCandidate = null;
    for (let depth = 0; current && depth < MAX_PATH_DEPTH; depth += 1) {
      if (SECTION_EXCLUDED_TAGS.has(current.tagName)) break;
      if (!fallback && SECTION_CONTAINER_TAGS.has(current.tagName)) fallback = current;

      const repeatedSelector = bestRepeatedSelector(current, root);
      if (repeatedSelector) {
        const tightnessBonus = current === commonAncestor ? 3 : 0;
        const score = scoreSectionCandidate(current, repeatedSelector.count, depth) +
          tightnessBonus -
          depth * 0.8;
        if (!bestCandidate || score > bestCandidate.score) {
          bestCandidate = { element: current, score };
        }
      }
      current = current.parentElement;
    }

    return bestCandidate?.element ?? fallback;
  }

  function buildRelativeSelectors(boundary, elements) {
    if (!(boundary instanceof Element)) return [];

    return [...new Set(
      elements
        .filter((element) => element instanceof Element)
        .map((element) => buildRelativeSelector(boundary, element))
        .filter(Boolean)
    )].slice(0, 32);
  }

  function buildRelativeSelector(boundary, element) {
    if (boundary === element) return ":scope";

    const path = [];
    let current = element;
    while (current && current !== boundary && path.length < MAX_PATH_DEPTH) {
      path.unshift(selectorForElement(current, true));
      current = current.parentElement;
    }
    return current === boundary && path.length ? `:scope > ${path.join(" > ")}` : "";
  }

  function childTowards(ancestor, target) {
    if (!(ancestor instanceof Element) || !(target instanceof Element)) return null;

    let current = target;
    while (current?.parentElement && current.parentElement !== ancestor) {
      current = current.parentElement;
    }
    return current?.parentElement === ancestor ? current : null;
  }

  function lowestCommonAncestor(elements) {
    const [first, ...rest] = elements;
    let candidate = first;

    while (candidate) {
      if (rest.every((element) => isAncestorOf(candidate, element))) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  }

  function isAncestorOf(ancestor, element) {
    let current = element;
    while (current) {
      if (current === ancestor) return true;
      current = current.parentElement;
    }
    return false;
  }

  function stableAttributeSelector(element) {
    return attributeSelectorsForElement(element)[0]?.suffix ?? "";
  }

  function bestRepeatedSelector(element, root) {
    const candidates = groupSelectorCandidates(element)
      .map((candidate) => ({ ...candidate, count: countMatches(candidate.selector, root) }))
      .filter((candidate) => candidate.count > 1)
      .sort((left, right) => right.priority - left.priority || left.count - right.count);
    return candidates[0] ?? null;
  }

  function groupSelectorCandidates(element) {
    const tag = element.localName;
    const candidates = attributeSelectorsForElement(element).map(({ suffix }) => ({
      selector: `${tag}${suffix}`,
      priority: 5
    }));
    const classes = [...element.classList].filter(isStableClass).slice(0, 6);

    for (let first = 0; first < classes.length; first += 1) {
      for (let second = first + 1; second < classes.length; second += 1) {
        candidates.push({
          selector: `${tag}.${CSS.escape(classes[first])}.${CSS.escape(classes[second])}`,
          priority: 4
        });
      }
    }
    classes.forEach((className) => {
      candidates.push({ selector: `${tag}.${CSS.escape(className)}`, priority: 3 });
    });

    parentAnchorSelectors(element.parentElement).forEach(({ selector, priority }) => {
      candidates.push({ selector: `${selector} > ${tag}`, priority });
    });

    const role = element.getAttribute("role")?.toLowerCase();
    if (role && SECTION_ROLES.has(role)) {
      candidates.push({ selector: `${tag}[role="${escapeAttributeValue(role)}"]`, priority: 2 });
    }
    if (tag === "article") candidates.push({ selector: "article", priority: 1 });
    return candidates;
  }

  function parentAnchorSelectors(parent) {
    if (!parent) return [];

    const anchors = [];
    if (parent.id) {
      anchors.push({ selector: `#${CSS.escape(parent.id)}`, priority: 4.5 });
    }
    attributeSelectorsForElement(parent).forEach(({ suffix }) => {
      anchors.push({ selector: `${parent.localName}${suffix}`, priority: 4 });
    });
    [...parent.classList].filter(isStableClass).slice(0, 3).forEach((className) => {
      anchors.push({
        selector: `${parent.localName}.${CSS.escape(className)}`,
        priority: 2.5
      });
    });
    return anchors;
  }

  function attributeSelectorsForElement(element) {
    const names = element.getAttributeNames?.() ?? [];
    return names
      .filter((name) => name.startsWith("data-"))
      .filter((name) => !/^data-(?:index|position|reactid|tracking|timestamp|uuid)$/i.test(name))
      .map((name) => ({ name, value: element.getAttribute(name) }))
      .filter(({ value }) => value && value.length <= 80 && !/\s{2,}/.test(value))
      .map(({ name, value }) => ({
        name,
        suffix: `[${name}="${escapeAttributeValue(value)}"]`
      }));
  }

  function scoreSectionCandidate(element, matchCount, depth) {
    if (!SECTION_CONTAINER_TAGS.has(element.tagName)) return Number.NEGATIVE_INFINITY;

    let score = -depth * 0.35;
    if (element.tagName === "ARTICLE") score += 7;
    if (element.tagName === "LI") score += 5;
    if (["DIV", "SECTION", "ASIDE"].includes(element.tagName)) score += 2;
    if (SECTION_ROLES.has(element.getAttribute("role")?.toLowerCase())) score += 5;
    score += Math.min(3, Math.log2(matchCount));
    score += Math.min(3, element.children?.length ?? 0);
    if (element.querySelector?.("img, video, picture, [role='img']")) score += 4;
    return score;
  }

  function escapeAttributeValue(value) {
    return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\a ");
  }

  global.BlurSelectors = Object.freeze({
    buildSelector,
    buildRelativeSelectors,
    childTowards,
    describeElement,
    findSectionCandidate,
    findSectionCandidateFromElements,
    isStableClass
  });
})(globalThis);
