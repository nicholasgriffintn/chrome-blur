const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const conditions = loadConditions();

test("parses a case-insensitive, deduplicated trigger list", () => {
  assert.deepEqual(
    Array.from(conditions.parseTerms(" Death,\ndeath\n final   score ")),
    ["Death", "final score"]
  );
});

test("matches exact words and phrases without matching word fragments", () => {
  assert.equal(conditions.findMatchingTerm("The final score is 2–1", ["FINAL SCORE"]), "FINAL SCORE");
  assert.equal(conditions.findMatchingTerm("The deadline is tomorrow", ["dead"]), null);
  assert.equal(conditions.findMatchingTerm("A death was reported", ["dead"]), null);
  assert.equal(conditions.findMatchingTerm("A death was reported", ["death"]), "death");
});

test("matches both section text and image alt text", () => {
  const image = {
    getAttribute(name) {
      return name === "alt" ? "The winner lifts the trophy" : null;
    }
  };
  const section = {
    textContent: "Match report",
    matches() {
      return false;
    },
    querySelectorAll(selector) {
      return selector === "img[alt]" ? [image] : [];
    }
  };

  assert.equal(conditions.sectionMatches(section, { triggerWords: ["winner"] }), true);
  assert.equal(
    conditions.sectionMatches(
      { ...section, querySelectorAll: () => [] },
      { triggerWords: ["winner"] }
    ),
    false
  );
  assert.equal(
    conditions.sectionMatches(
      { ...section, textContent: "Player eliminated" },
      { triggerWords: ["eliminated"] }
    ),
    true
  );
});

test("applies always-on sections and gates conditional sections on a match", () => {
  const section = {
    textContent: "A routine update",
    matches: () => false,
    querySelectorAll: () => []
  };

  assert.equal(
    conditions.shouldBlurSection(section, conditions.SECTION_CONDITIONS.ALWAYS, []),
    true
  );
  assert.equal(
    conditions.shouldBlurSection(
      section,
      conditions.SECTION_CONDITIONS.TRIGGER,
      { triggerWords: ["death"] }
    ),
    false
  );
  assert.equal(
    conditions.shouldBlurSection(
      { ...section, textContent: "A death was reported" },
      conditions.SECTION_CONDITIONS.TRIGGER,
      { triggerWords: ["death"] }
    ),
    true
  );
});

test("exposes filter packs without enabling them automatically", () => {
  assert.ok(conditions.PRESETS.spoilers.includes("winner"));
  assert.ok(conditions.PRESETS.spoilers.includes("recap"));
  assert.ok(conditions.PRESETS.violence.includes("death"));
  assert.ok(conditions.PRESETS.violence.includes("wounded"));
  assert.ok(conditions.PRESETS.results.includes("final score"));
  assert.ok(conditions.PRESETS.results.includes("table"));
  assert.ok(conditions.PRESETS.results.includes("penalties"));
  assert.deepEqual(Array.from(conditions.parseTerms([])), []);
});

test("results filtering rejects ambiguous everyday uses", () => {
  const config = presetConfig("results");

  assert.equal(conditions.sectionMatches(createSection("The table is made from oak"), config), false);
  assert.equal(conditions.sectionMatches(createSection("The raffle draw closes Friday"), config), false);
  assert.equal(
    conditions.sectionMatches(createSection("Your credit score result is now available"), config),
    false
  );
  assert.equal(
    conditions.sectionMatches(
      createSection("Apply for a full-time role and draw a benefits table"),
      config
    ),
    false
  );
  assert.equal(
    conditions.sectionMatches(
      createSection(
        "Five ways to make the most of the summer holidays with kids " +
          "Views 6,976 Engaged 0:53 WF % 9.7 Female % 60 16-24 % 20 Published Date Today 00:29"
      ),
      config
    ),
    false
  );
});

test("results filtering accepts score patterns and sports context", () => {
  const config = presetConfig("results");

  assert.equal(
    conditions.sectionMatches(createSection("Arsenal 2–1 Chelsea · FT"), config),
    true
  );
  assert.equal(
    conditions.sectionMatches(
      createSection("Match report: United defeated City after penalties"),
      config
    ),
    true
  );
  assert.equal(
    conditions.sectionMatches(createSection("FT · Arsenal vs Chelsea"), config),
    true
  );
  assert.equal(
    conditions.sectionMatches(createSection("Arsenal defeats Chelsea"), config),
    true
  );
});

test("spoiler filtering requires entertainment or user-supplied title context", () => {
  const config = presetConfig("spoilers");

  assert.equal(
    conditions.sectionMatches(createSection("A satisfying ending to the working day"), config),
    false
  );
  assert.equal(
    conditions.sectionMatches(createSection("The winner of our office raffle"), config),
    false
  );
  assert.equal(
    conditions.sectionMatches(createSection("Series finale: the winner is revealed"), config),
    true
  );
  assert.equal(
    conditions.sectionMatches(
      createSection("Bake Off winner revealed"),
      { ...config, contextWords: ["Bake Off"] }
    ),
    true
  );
});

test("violence filtering remains broad for safety", () => {
  assert.equal(
    conditions.sectionMatches(
      createSection("Police said two people were injured in an attack"),
      presetConfig("violence")
    ),
    true
  );
});

test("violence filtering covers acute disasters and human-targeted threats", () => {
  const config = presetConfig("violence");
  const headlines = [
    "Firefighters struggle to contain Madrid wildfires, as more than 140,000 evacuated in France and Spain",
    "Police declare 'major incident' as wind change increases Cairngorms wildfire risk",
    "Judge demands answers after 'dangerous' man who threatened to 'chop up' woman was released on bail"
  ];

  for (const headline of headlines) {
    assert.equal(conditions.sectionMatches(createSection(headline), config), true, headline);
  }
});

test("violence filtering rejects ambiguous fire, incident and commercial threat language", () => {
  const config = presetConfig("violence");
  const headlines = [
    "The fire sale ends on Friday",
    "Officials discussed a minor incident in the report",
    "The company threatened to withdraw its offer",
    "Learn how to chop up an onion"
  ];

  for (const headline of headlines) {
    assert.equal(conditions.sectionMatches(createSection(headline), config), false, headline);
  }
});

test("normalises Unicode punctuation, hyphens, apostrophes and simple plurals", () => {
  assert.equal(
    conditions.sectionMatches(createSection("Liverpool 3—0 Everton · full‑time"), presetConfig("results")),
    true
  );
  assert.equal(
    conditions.sectionMatches(createSection("Series runners‑up revealed"), presetConfig("spoilers")),
    true
  );
  assert.equal(
    conditions.sectionMatches(
      createSection("Bob’s Burgers winners revealed"),
      { ...presetConfig("spoilers"), contextWords: ["Bob's Burgers"] }
    ),
    true
  );
});

test("extracts headings, link text, metadata, aria labels and image descriptions", () => {
  const section = createSection("Ordinary visible copy", {
    headings: ["Series finale"],
    links: ["Read the winner interview"],
    metadata: ["Episode 10 recap"],
    ariaLabels: ["Contest result"],
    imageAlts: ["The unmasked contestant"]
  });

  assert.equal(conditions.sectionMatches(section, presetConfig("spoilers")), true);
});

function loadConditions() {
  const context = vm.createContext({});
  const source = fs.readFileSync(
    path.join(__dirname, "..", "lib", "text-conditions.js"),
    "utf8"
  );
  vm.runInContext(source, context);
  return context.BlurTextConditions;
}

function presetConfig(preset) {
  return {
    enabledPresets: [preset],
    triggerWords: [],
    contextWords: []
  };
}

function createSection(text, parts = {}) {
  const nodes = {
    headings: createTextNodes(parts.headings),
    links: createTextNodes(parts.links),
    metadata: createTextNodes(parts.metadata),
    ariaLabels: createAttributeNodes("aria-label", parts.ariaLabels),
    imageAlts: createAttributeNodes("alt", parts.imageAlts)
  };

  return {
    innerText: text,
    textContent: text,
    matches: () => false,
    querySelectorAll(selector) {
      if (selector === "img[alt]") return nodes.imageAlts;
      if (selector.includes("aria-label")) return nodes.ariaLabels;
      if (selector.includes("h1")) return nodes.headings;
      if (selector === "a") return nodes.links;
      if (selector.includes("time")) return nodes.metadata;
      return [];
    }
  };
}

function createTextNodes(values = []) {
  return values.map((textContent) => ({ innerText: textContent, textContent }));
}

function createAttributeNodes(attribute, values = []) {
  return values.map((value) => ({
    getAttribute(name) {
      return name === attribute ? value : null;
    }
  }));
}
