const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const repositoryRoot = path.resolve(__dirname, "..");
const core = loadGlobalScripts(["lib/text-conditions.js", "lib/state.js"], "BlurCore");

test("normalises malformed persisted state to safe defaults", () => {
  const state = core.normaliseState({
    enabled: "yes",
    activeProfileId: "missing",
    profiles: [
      {
        id: "work",
        name: "  Work  ",
        sitePatterns: [" Example.com/ ", "example.com"],
        blurAmount: 250,
        blurMedia: false,
        enabledPresets: ["results", "invalid", "results"],
        triggerWords: [" Death ", "death", "final score"],
        contextWords: [" Bake Off ", "bake off", "Arsenal"],
        rules: [
          { selector: "  .headline  ", kind: "unexpected", condition: "trigger" },
          { selector: ".card", kind: "section", condition: "trigger" },
          { nope: true }
        ]
      }
    ]
  });

  assert.equal(state.enabled, true);
  assert.equal(state.activeProfileId, "work");
  assert.deepEqual(Array.from(state.profiles[0].sitePatterns), ["example.com"]);
  assert.equal(state.profiles[0].blurAmount, 100);
  assert.equal(state.profiles[0].blurPii, true);
  assert.deepEqual(Array.from(state.profiles[0].triggerWords), ["Death", "final score"]);
  assert.deepEqual(Array.from(state.profiles[0].enabledPresets), ["results"]);
  assert.deepEqual(Array.from(state.profiles[0].contextWords), ["Bake Off", "Arsenal"]);
  assert.equal(state.profiles[0].rules.length, 2);
  assert.equal(state.profiles[0].rules[0].kind, "element");
  assert.equal(state.profiles[0].rules[0].condition, "always");
  assert.equal(state.profiles[0].rules[1].condition, "trigger");
});

test("enables sensitive-data protection for default and new profiles", () => {
  assert.equal(core.createDefaultState().profiles[0].blurPii, true);
  assert.equal(core.createProfile("Work").blurPii, true);
  assert.equal(
    core.normaliseState({
      enabled: true,
      activeProfileId: "work",
      profiles: [{
        ...enabledProfile(["example.com"]),
        id: "work",
        blurPii: false
      }]
    }).profiles[0].blurPii,
    false
  );
});

test("preserves the relative targets of a drawn section rule", () => {
  const state = core.normaliseState({
    enabled: true,
    activeProfileId: "work",
    profiles: [{
      ...enabledProfile(["example.com"]),
      id: "work",
      rules: [{
        id: "drawn",
        selector: ".result-row",
        kind: "section",
        label: "Drawn result",
        targetSelectors: [":scope > img.cover", ":scope > .copy > h2", "", ":scope > img.cover"]
      }]
    }]
  });

  assert.deepEqual(
    Array.from(state.profiles[0].rules[0].targetSelectors),
    [":scope > img.cover", ":scope > .copy > h2"]
  );
});

test("matches exact hosts without leaking into suffix lookalikes", () => {
  const profile = enabledProfile(["example.com"]);

  assert.equal(core.profileMatchesUrl(profile, "https://example.com/story"), true);
  assert.equal(core.profileMatchesUrl(profile, "https://www.example.com/story"), false);
  assert.equal(core.profileMatchesUrl(profile, "https://example.com.attacker.test/story"), false);
});

test("matches wildcard subdomains and the root hostname", () => {
  const profile = enabledProfile(["*.example.com"]);

  assert.equal(core.profileMatchesUrl(profile, "https://example.com"), true);
  assert.equal(core.profileMatchesUrl(profile, "https://news.example.com"), true);
  assert.equal(core.profileMatchesUrl(profile, "https://notexample.com"), false);
});

test("supports host paths and complete URL globs", () => {
  assert.equal(
    core.profileMatchesUrl(enabledProfile(["example.com/private/*"]), "https://example.com/private/report?id=3"),
    true
  );
  assert.equal(
    core.profileMatchesUrl(enabledProfile(["https://example.com/team/*"]), "http://example.com/team/one"),
    false
  );
  assert.equal(
    core.profileMatchesUrl(enabledProfile(["https://example.com"]), "https://example.com/"),
    true
  );
});

test("rejects malformed or unsafe site patterns", () => {
  assert.equal(core.getPatternError("https://example.com/private/*"), "");
  assert.equal(core.getPatternError("*.example.com"), "");
  assert.match(core.getPatternError("javascript://example.com"), /HTTP/);
  assert.match(core.getPatternError("example .com"), /spaces/);
  assert.deepEqual(Array.from(core.parsePatterns("example.com\nexample .com\njavascript://x")), ["example.com"]);
});

test("returns only active profiles matching a web URL", () => {
  const state = {
    enabled: true,
    activeProfileId: "one",
    profiles: [
      { ...enabledProfile(["example.com"]), id: "one" },
      { ...enabledProfile(["example.com"]), id: "two", enabled: false },
      { ...enabledProfile(["other.test"]), id: "three" }
    ]
  };

  assert.deepEqual(core.matchingProfiles(state, "https://example.com").map((profile) => profile.id), ["one"]);
  assert.equal(core.matchingProfiles({ ...state, enabled: false }, "https://example.com").length, 0);
});

test("maps blur percentages onto a bounded pixel radius", () => {
  assert.equal(core.blurPixels(0), 0);
  assert.equal(core.blurPixels(50), 12);
  assert.equal(core.blurPixels(100), 24);
  assert.equal(core.blurPixels(999), 24);
});

test("manifest contains no remote scripts and uses document-start injection", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "manifest.json"), "utf8"));
  const [contentScript] = manifest.content_scripts;
  const packagedFiles = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...contentScript.css,
    ...contentScript.js,
    ...Object.values(manifest.icons)
  ];

  assert.equal(manifest.manifest_version, 3);
  assert.equal(contentScript.run_at, "document_start");
  assert.deepEqual(contentScript.matches, ["<all_urls>"]);
  assert.equal(packagedFiles.every((file) => fs.existsSync(path.join(repositoryRoot, file))), true);
  assert.equal(JSON.stringify(manifest).includes("http://"), false);
  assert.equal(JSON.stringify(manifest).includes("https://"), false);
});

function enabledProfile(patterns) {
  return {
    id: "profile",
    name: "Profile",
    enabled: true,
    sitePatterns: patterns,
    blurAmount: 65,
    blurMedia: true,
    rules: []
  };
}

function loadGlobalScripts(relativePaths, globalName) {
  const context = vm.createContext({ crypto: webcrypto, URL });
  for (const relativePath of relativePaths) {
    const source = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
    vm.runInContext(source, context);
  }
  return context[globalName];
}
