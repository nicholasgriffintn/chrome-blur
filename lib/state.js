(function initialiseBlurCore(global) {
  "use strict";

  const STORAGE_KEY = "blurState"; // allow-secret
  const MAX_BLUR_PIXELS = 24;
  const DEFAULT_STATE = Object.freeze({
    enabled: true,
    activeProfileId: "default",
    profiles: [
      {
        id: "default",
        name: "Default",
        enabled: true,
        sitePatterns: [],
        blurAmount: 65,
        blurMedia: true,
        blurPii: true,
        enabledPresets: [],
        triggerWords: [],
        contextWords: [],
        rules: []
      }
    ]
  });

  function createDefaultState() {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  function createProfile(name = "New profile", sitePattern = "") {
    return {
      id: crypto.randomUUID(),
      name: normaliseName(name),
      enabled: true,
      sitePatterns: sitePattern ? [normalisePattern(sitePattern)] : [],
      blurAmount: 65,
      blurMedia: true,
      blurPii: true,
      enabledPresets: [],
      triggerWords: [],
      contextWords: [],
      rules: []
    };
  }

  function normaliseState(value) {
    if (!value || !Array.isArray(value.profiles)) return createDefaultState();

    const profiles = value.profiles.map(normaliseProfile).filter(Boolean);
    if (!profiles.length) return createDefaultState();

    return {
      enabled: value.enabled !== false,
      activeProfileId: profiles.some((profile) => profile.id === value.activeProfileId)
        ? value.activeProfileId
        : profiles[0].id,
      profiles
    };
  }

  function normaliseProfile(profile) {
    if (!profile || typeof profile.id !== "string" || typeof profile.name !== "string") return null;

    return {
      id: profile.id,
      name: normaliseName(profile.name),
      enabled: profile.enabled !== false,
      sitePatterns: Array.isArray(profile.sitePatterns)
        ? [...new Set(profile.sitePatterns.map(normalisePattern).filter(Boolean))]
        : [],
      blurAmount: clampNumber(profile.blurAmount, 0, 100, 65),
      blurMedia: profile.blurMedia !== false,
      blurPii: profile.blurPii !== false,
      enabledPresets: BlurTextConditions.parsePresetNames(profile.enabledPresets),
      triggerWords: BlurTextConditions.parseTerms(profile.triggerWords),
      contextWords: BlurTextConditions.parseTerms(profile.contextWords),
      rules: Array.isArray(profile.rules) ? profile.rules.map(normaliseRule).filter(Boolean) : []
    };
  }

  function normaliseRule(rule) {
    if (!rule || typeof rule.selector !== "string" || !rule.selector.trim()) return null;

    const kind = rule.kind === "section" ? "section" : "element";
    return {
      id: typeof rule.id === "string" ? rule.id : crypto.randomUUID(),
      selector: rule.selector.trim(),
      kind,
      label: typeof rule.label === "string" && rule.label.trim()
        ? rule.label.trim().slice(0, 80)
        : rule.selector.trim().slice(0, 80),
      enabled: rule.enabled !== false,
      condition: kind === "section" &&
        rule.condition === BlurTextConditions.SECTION_CONDITIONS.TRIGGER
        ? BlurTextConditions.SECTION_CONDITIONS.TRIGGER
        : BlurTextConditions.SECTION_CONDITIONS.ALWAYS
    };
  }

  function normaliseName(value) {
    const name = String(value ?? "").trim().slice(0, 48);
    return name || "Untitled profile";
  }

  function normalisePattern(value) {
    const pattern = String(value ?? "").trim().toLowerCase();
    if (pattern.includes("://")) {
      return /^[a-z]+:\/\/[^/]+$/.test(pattern) ? `${pattern}/` : pattern;
    }
    return pattern.replace(/\/+$/, "");
  }

  function parsePatterns(value) {
    return [...new Set(
      String(value ?? "")
        .split(/[\n,]/)
        .map(normalisePattern)
        .filter(Boolean)
    )];
  }

  function profileMatchesUrl(profile, value) {
    if (!profile?.enabled || !Array.isArray(profile.sitePatterns) || !profile.sitePatterns.length) return false;

    let url;
    try {
      url = new URL(value);
    } catch {
      return false;
    }

    if (!["http:", "https:"].includes(url.protocol)) return false;
    return profile.sitePatterns.some((pattern) => patternMatchesUrl(pattern, url));
  }

  function patternMatchesUrl(rawPattern, url) {
    const pattern = normalisePattern(rawPattern);
    if (!pattern) return false;
    if (pattern === "*") return true;

    if (pattern.includes("://")) {
      return globMatches(pattern, url.href.toLowerCase());
    }

    const slashIndex = pattern.indexOf("/");
    const hostPattern = slashIndex === -1 ? pattern : pattern.slice(0, slashIndex);
    const pathPattern = slashIndex === -1 ? "" : pattern.slice(slashIndex);
    const hostname = url.hostname.toLowerCase();
    const hostMatches = hostPattern.startsWith("*.")
      ? hostname === hostPattern.slice(2) || hostname.endsWith(`.${hostPattern.slice(2)}`)
      : hostname === hostPattern;

    return hostMatches && (!pathPattern || globMatches(pathPattern, `${url.pathname}${url.search}`.toLowerCase()));
  }

  function globMatches(pattern, value) {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*");
    return new RegExp(`^${escaped}$`, "i").test(value);
  }

  function matchingProfiles(state, url) {
    const safeState = normaliseState(state);
    if (!safeState.enabled) return [];
    return safeState.profiles.filter((profile) => profileMatchesUrl(profile, url));
  }

  function blurPixels(amount) {
    return Math.round(clampNumber(amount, 0, 100, 65) / 100 * MAX_BLUR_PIXELS);
  }

  function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  }

  global.BlurCore = Object.freeze({
    STORAGE_KEY,
    DEFAULT_STATE,
    createDefaultState,
    createProfile,
    normaliseState,
    normalisePattern,
    parsePatterns,
    profileMatchesUrl,
    matchingProfiles,
    blurPixels
  });
})(globalThis);
