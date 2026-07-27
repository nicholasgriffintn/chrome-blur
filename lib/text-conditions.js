(function initialiseBlurTextConditions(global) {
  "use strict";

  const MAX_TERMS = 100;
  const MAX_TERM_LENGTH = 80;
  const MAX_MATCHER_CACHE_SIZE = 32;
  const CONTEXT_DISTANCE = 140;
  const matcherCache = new Map();
  const SECTION_CONDITIONS = Object.freeze({
    ALWAYS: "always",
    TRIGGER: "trigger"
  });
  const PRESETS = Object.freeze({
    spoilers: Object.freeze([
      "spoiler", "spoilers",
      "winner", "wins", "won",
      "runner-up", "eliminated", "evicted", "voted out",
      "revealed", "reveal", "unmasked",
      "ending", "finale", "final episode",
      "plot twist", "twist", "cliffhanger",
      "dies", "died", "death",
      "recap"
    ]),
    violence: Object.freeze([
      "violence", "violent",
      "death", "deaths", "dead", "dies", "died",
      "killed", "killing", "murder", "murdered",
      "abduction", "abducted", "kidnap", "kidnapped", "kidnapping",
      "rape", "raped", "sexual assault",
      "shooting", "shot", "gunfire",
      "stabbing", "stabbed",
      "assault", "attacked", "attack",
      "bomb", "bombing", "explosion",
      "massacre", "fatal", "casualties",
      "injured", "wounded"
    ]),
    results: Object.freeze([
      "score", "scores", "result", "results",
      "final score", "full-time", "full time",
      "half-time", "half time",
      "winner", "wins", "won", "defeats", "defeated",
      "beats", "beat", "loses", "lost",
      "draw", "tied",
      "highlights", "match report",
      "standings", "table",
      "qualifies", "qualified", "eliminated",
      "penalties"
    ])
  });
  const PRESET_NAMES = Object.freeze(Object.keys(PRESETS));
  const STRONG_SAFETY_EVENT_TERMS = Object.freeze([
    "wildfire", "evacuated", "evacuation", "major incident", "unburied"
  ]);
  const ARMED_CONFLICT_TERMS = Object.freeze([
    "war", "wars", "warfare"
  ]);
  const ARMED_CONFLICT_CONTEXT_TERMS = Object.freeze([
    "airstrike", "armed", "army", "battle", "bomb", "conflict", "drone",
    "forces", "invasion", "military", "missile", "strike", "troops"
  ]);
  const ACUTE_FIRE_TERMS = Object.freeze([
    "flames"
  ]);
  const ACUTE_FIRE_CONTEXT_TERMS = Object.freeze([
    "blaze", "contain", "crews", "emergency", "evacuated", "evacuation",
    "fire", "firefighter", "firefighters", "fights", "intense", "military",
    "wildfire"
  ]);
  const HUMAN_THREAT_TERMS = Object.freeze([
    "threat", "threatened", "threatening", "chop up"
  ]);
  const PERSON_CONTEXT_TERMS = Object.freeze([
    "man", "woman", "person", "people", "boy", "girl", "child", "children",
    "baby", "victim", "resident", "family"
  ]);
  const STRONG_SPOILER_TERMS = Object.freeze([
    "spoiler", "spoilers", "runner-up", "voted out", "unmasked",
    "final episode", "plot twist", "cliffhanger"
  ]);
  const SPOILER_CONTEXT_TERMS = Object.freeze([
    "show", "series", "season", "episode", "film", "movie", "character",
    "contestant", "competition", "reality tv", "cast", "actor", "actress",
    "novel", "book", "drama", "sitcom", "documentary", "game show"
  ]);
  const STRONG_RESULT_TERMS = Object.freeze([
    "final score", "match report"
  ]);
  const SPORT_CONTEXT_TERMS = Object.freeze([
    "match", "league", "cup", "tournament", "goal", "goals", "fixture",
    "coach", "club", "semi-final", "quarter-final", "versus", "vs",
    "football", "soccer", "rugby", "cricket", "tennis", "basketball",
    "baseball", "hockey", "boxing", "golf"
  ]);
  const SCORE_STATUS_TERMS = Object.freeze([
    "ft", "full-time", "full time", "half-time", "half time"
  ]);
  const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6, [role=\"heading\"]";
  const METADATA_SELECTOR = [
    "time",
    "[class*=\"meta\" i]",
    "[class*=\"score\" i]",
    "[class*=\"result\" i]",
    "[data-testid*=\"meta\" i]",
    "[data-testid*=\"score\" i]"
  ].join(", ");
  const NAMED_RESULT_PATTERN = new RegExp(
    String.raw`\b[\p{Lu}][\p{L}\p{M}'’-]*(?:\s+[\p{Lu}][\p{L}\p{M}'’-]*){0,2}\s+` +
      String.raw`(?:defeats?|beats?|loses?\s+to|draws?\s+with|ties?\s+with)\s+` +
      String.raw`[\p{Lu}][\p{L}\p{M}'’-]*(?:\s+[\p{Lu}][\p{L}\p{M}'’-]*){0,2}\b`,
    "u"
  );

  function parseTerms(value) {
    const values = Array.isArray(value) ? value : String(value ?? "").split(/[\n,]/);
    const terms = [];
    const seen = new Set();

    for (const valueItem of values) {
      const term = normaliseTerm(valueItem);
      const key = foldText(term);
      if (!term || seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
      if (terms.length === MAX_TERMS) break;
    }

    return terms;
  }

  function parsePresetNames(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((name) => PRESET_NAMES.includes(name)))];
  }

  function findMatchingTerm(value, terms) {
    const text = foldText(value);
    if (!text) return null;

    for (const matcher of compileMatchers(terms)) {
      if (matcher.pattern.test(text)) return matcher.term;
    }

    return null;
  }

  function sectionMatches(section, config) {
    if (!section) return false;

    const matcherConfig = normaliseMatcherConfig(config);
    const content = extractSectionContent(section);
    if (findMatchingTerm(content.allText, matcherConfig.triggerWords)) return true;

    for (const presetName of matcherConfig.enabledPresets) {
      if (presetName === "violence" && violencePresetMatches(content)) {
        return true;
      }
      if (presetName === "spoilers" && spoilerPresetMatches(content, matcherConfig.contextWords)) {
        return true;
      }
      if (presetName === "results" && resultsPresetMatches(content, matcherConfig.contextWords)) {
        return true;
      }
    }

    return false;
  }

  function shouldBlurSection(section, condition, config) {
    return condition !== SECTION_CONDITIONS.TRIGGER || sectionMatches(section, config);
  }

  function extractSectionContent(section) {
    const visibleText = readableText(section);
    const headings = collectNodeText(section, HEADING_SELECTOR);
    const links = collectNodeText(section, "a");
    const metadata = collectNodeText(section, METADATA_SELECTOR);
    const ariaLabels = collectAttributes(section, "[aria-label]", "aria-label");
    const imageAlts = collectAttributes(section, "img[alt]", "alt");
    const allText = uniqueParts([
      visibleText,
      headings,
      links,
      metadata,
      ariaLabels,
      imageAlts
    ]).join(" ");

    return Object.freeze({
      visibleText,
      headings,
      links,
      metadata,
      ariaLabels,
      imageAlts,
      allText
    });
  }

  function violencePresetMatches(content) {
    if (findMatchingTerm(content.allText, PRESETS.violence)) return true;
    if (findMatchingTerm(content.allText, STRONG_SAFETY_EVENT_TERMS)) return true;
    if (termsAppearNear(
      content.allText,
      ARMED_CONFLICT_TERMS,
      ARMED_CONFLICT_CONTEXT_TERMS
    )) {
      return true;
    }
    if (termsAppearNear(content.allText, ACUTE_FIRE_TERMS, ACUTE_FIRE_CONTEXT_TERMS)) {
      return true;
    }
    return termsAppearNear(content.allText, HUMAN_THREAT_TERMS, PERSON_CONTEXT_TERMS);
  }

  function spoilerPresetMatches(content, contextWords) {
    if (findMatchingTerm(content.allText, STRONG_SPOILER_TERMS)) return true;

    const context = [...SPOILER_CONTEXT_TERMS, ...parseTerms(contextWords)];
    return termsAppearNear(content.allText, PRESETS.spoilers, context);
  }

  function resultsPresetMatches(content, contextWords) {
    if (containsContextualScorePattern(content.allText, contextWords)) return true;
    if (findMatchingTerm(content.allText, STRONG_RESULT_TERMS)) return true;
    if (NAMED_RESULT_PATTERN.test(normalisePunctuation(content.allText))) return true;

    const context = [...SPORT_CONTEXT_TERMS, ...parseTerms(contextWords)];
    if (termsAppearNear(content.allText, ["ft"], context)) return true;
    return termsAppearNear(content.allText, PRESETS.results, context);
  }

  function containsContextualScorePattern(value, contextWords) {
    const text = normalisePunctuation(value);
    if (!containsScorePattern(text)) return false;

    return Boolean(findMatchingTerm(
      text,
      [...SPORT_CONTEXT_TERMS, ...SCORE_STATUS_TERMS, ...parseTerms(contextWords)]
    ));
  }

  function containsScorePattern(value) {
    const text = normalisePunctuation(value);
    return /(?:^|[^\d])(?:\d{1,3})\s*(?:-|:)\s*(?:\d{1,3})(?!\d)/u.test(text);
  }

  function termsAppearNear(value, triggerTerms, contextTerms) {
    const text = foldText(value);
    if (!text) return false;

    const triggerRanges = findMatchRanges(text, triggerTerms);
    const contextRanges = findMatchRanges(text, contextTerms);
    return triggerRanges.some((trigger) => contextRanges.some((context) =>
      rangesAreNear(trigger, context, CONTEXT_DISTANCE)
    ));
  }

  function findMatchRanges(text, terms) {
    const ranges = [];
    for (const matcher of compileMatchers(terms)) {
      const pattern = new RegExp(matcher.pattern.source, "gu");
      for (const match of text.matchAll(pattern)) {
        ranges.push([match.index, match.index + match[0].length]);
      }
    }
    return ranges;
  }

  function rangesAreNear(first, second, distance) {
    if (first[0] <= second[1] && second[0] <= first[1]) return true;
    return Math.min(Math.abs(first[0] - second[1]), Math.abs(second[0] - first[1])) <= distance;
  }

  function normaliseMatcherConfig(value) {
    const config = value && !Array.isArray(value) ? value : {};
    return {
      enabledPresets: parsePresetNames(config.enabledPresets),
      triggerWords: parseTerms(config.triggerWords),
      contextWords: parseTerms(config.contextWords)
    };
  }

  function collectNodeText(section, selector) {
    const values = [];
    if (section.matches?.(selector)) values.push(readableText(section));
    section.querySelectorAll?.(selector).forEach((node) => values.push(readableText(node)));
    return uniqueParts(values).join(" ");
  }

  function collectAttributes(section, selector, attributeName) {
    const values = [];
    if (section.matches?.(selector)) values.push(section.getAttribute(attributeName) ?? "");
    section.querySelectorAll?.(selector).forEach((node) => {
      values.push(node.getAttribute(attributeName) ?? "");
    });
    return uniqueParts(values).join(" ");
  }

  function readableText(node) {
    if (typeof node?.innerText === "string") return node.innerText.trim();
    return String(node?.textContent ?? "").trim();
  }

  function uniqueParts(values) {
    return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
  }

  function normaliseTerm(value) {
    return normalisePunctuation(value)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TERM_LENGTH);
  }

  function foldText(value) {
    return normalisePunctuation(value)
      .toLowerCase()
      .replace(/-/g, " ")
      .replace(/\p{L}[\p{L}\p{M}]*/gu, normalisePluralToken)
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalisePunctuation(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .replace(/[\u2018\u2019\u02bc]/g, "'")
      .replace(/[\u2010-\u2015\u2212]/g, "-");
  }

  function normalisePluralToken(token) {
    if (token === "series" || token === "news" || token.length <= 4) return token;
    if (/[^aeiou]ies$/u.test(token)) return `${token.slice(0, -3)}y`;
    if (/(?:ches|shes|xes|zes|ses)$/u.test(token)) return token.slice(0, -2);
    if (
      token.endsWith("s") &&
      !token.endsWith("ss") &&
      !token.endsWith("us") &&
      !token.endsWith("is")
    ) {
      return token.slice(0, -1);
    }
    return token;
  }

  function compileMatchers(terms) {
    const parsedTerms = parseTerms(terms);
    const cacheKey = parsedTerms.map(foldText).join("\u0000");
    if (matcherCache.has(cacheKey)) return matcherCache.get(cacheKey);

    const matchers = parsedTerms.map((term) => ({
      term,
      pattern: compilePattern(foldText(term))
    }));
    if (matcherCache.size === MAX_MATCHER_CACHE_SIZE) {
      matcherCache.delete(matcherCache.keys().next().value);
    }
    matcherCache.set(cacheKey, matchers);
    return matchers;
  }

  function compilePattern(term) {
    const beginsWithWord = /^[\p{L}\p{N}]/u.test(term);
    const endsWithWord = /[\p{L}\p{N}]$/u.test(term);
    const start = beginsWithWord ? "(?:^|[^\\p{L}\\p{N}])" : "";
    const end = endsWithWord ? "(?=$|[^\\p{L}\\p{N}])" : "";
    return new RegExp(`${start}${escapeRegExp(term)}${end}`, "u");
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  global.BlurTextConditions = Object.freeze({
    PRESETS,
    SECTION_CONDITIONS,
    parseTerms,
    parsePresetNames,
    findMatchingTerm,
    extractSectionContent,
    sectionMatches,
    shouldBlurSection
  });
})(globalThis);
