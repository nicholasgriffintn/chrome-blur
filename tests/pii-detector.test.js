const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const detector = loadDetector();

test("finds common personal and sensitive information in page text", () => {
  const fixtures = [
    ["Email jane.doe+demo@example.co.uk for access", "jane.doe+demo@example.co.uk", "email"],
    ["Call +44 20 7946 0958 for support", "+44 20 7946 0958", "phone"],
    ["Card 4111 1111 1111 1111 expires soon", "4111 1111 1111 1111", "payment-card"],
    ["Last login came from 89.160.20.112", "89.160.20.112", "ip-address"],
    ["National Insurance number AB 12 34 56 C", "AB 12 34 56 C", "identity-number"],
    ["Social Security number 123-45-6789", "123-45-6789", "identity-number"]
  ];

  for (const [text, expectedValue, expectedType] of fixtures) {
    assert.deepEqual(
      Array.from(detector.findSensitiveRanges(text), (range) => ({
        value: text.slice(range.start, range.end),
        type: range.type
      })),
      [{ value: expectedValue, type: expectedType }],
      text
    );
  }
});

test("finds validated IBANs, plain mobile numbers and strong postal addresses", () => {
  const fixtures = [
    [
      "IBAN GB82 WEST 1234 5698 7654 32 is active",
      "GB82 WEST 1234 5698 7654 32",
      "iban"
    ],
    ["Pay GB82WEST12345698765432 today", "GB82WEST12345698765432", "iban"],
    ["Mobile 07123456789", "07123456789", "phone"],
    ["Office: 42 Example Road", "42 Example Road", "address"],
    ["Postcode W1A 1AA", "W1A 1AA", "address"]
  ];

  for (const [text, expectedValue, expectedType] of fixtures) {
    assert.deepEqual(
      Array.from(detector.findSensitiveRanges(text), (range) => ({
        value: text.slice(range.start, range.end),
        type: range.type
      })),
      [{ value: expectedValue, type: expectedType }],
      text
    );
  }
});

test("finds personal values in explicitly labelled prose", () => {
  const fixtures = [
    ["Name: Alex Example", "Alex Example", "name"],
    ["Date of birth: 12 March 1990", "12 March 1990", "birth-date"],
    ["Sort code: 12-34-56", "12-34-56", "financial-account"],
    ["Bank account: 12345678", "12345678", "financial-account"],
    ["Passport number: 123456789", "123456789", "identity-number"],
    ["Security answer: Example phrase", "Example phrase", "credential"]
  ];

  for (const [text, expectedValue, expectedType] of fixtures) {
    assert.deepEqual(
      Array.from(detector.findSensitiveRanges(text), (range) => ({
        value: text.slice(range.start, range.end),
        type: range.type
      })),
      [{ value: expectedValue, type: expectedType }],
      text
    );
  }
});

test("rejects common numeric false positives and invalid identifiers", () => {
  const text = [
    "Published 2026-07-25",
    "Order 123456",
    "Score 3-1",
    "Invalid card 4111 1111 1111 1112",
    "Invalid address 999.168.1.1",
    "Invalid IBAN GB82 WEST 1234 5698 7654 31",
    "Example IP 203.0.113.42",
    "Local IP 192.168.1.20"
  ].join(" · ");

  assert.deepEqual(Array.from(detector.findSensitiveRanges(text)), []);
});

test("rejects impossible National Insurance prefixes", () => {
  for (const prefix of ["BG", "GB", "KN", "NK", "NT", "TN", "ZZ"]) {
    assert.deepEqual(
      Array.from(detector.findSensitiveRanges(`${prefix} 12 34 56 C`)),
      [],
      prefix
    );
  }
  assert.equal(
    detector.findSensitiveRanges("AA 12 34 56 C")[0]?.type,
    "identity-number"
  );
});

test("returns ordered, non-overlapping ranges", () => {
  const text = "Call 202-555-0123 or email team@example.com";
  const ranges = Array.from(detector.findSensitiveRanges(text));

  assert.deepEqual(
    ranges.map(({ start, end, type }) => ({ value: text.slice(start, end), type })),
    [
      { value: "202-555-0123", type: "phone" },
      { value: "team@example.com", type: "email" }
    ]
  );
  assert.ok(ranges[0].end <= ranges[1].start);
});

test("identifies sensitive form fields without reading beyond their local value", () => {
  assert.equal(detector.fieldNeedsBlur({ type: "password", value: "" }), true);
  assert.equal(detector.fieldNeedsBlur({ type: "email", value: "jane@example.com" }), true);
  assert.equal(detector.fieldNeedsBlur({ type: "tel", value: "+44 20 7946 0958" }), true);
  assert.equal(detector.fieldNeedsBlur({ type: "text", value: "jane@example.com" }), true);
  assert.equal(detector.fieldNeedsBlur({ type: "email", value: "" }), true);
  assert.equal(detector.fieldNeedsBlur({ type: "tel", value: "" }), true);
  assert.equal(detector.fieldNeedsBlur({ type: "hidden", name: "email", value: "jane@example.com" }), false);
  assert.equal(detector.fieldNeedsBlur({ type: "text", value: "Order 123456" }), false);
});

test("protects semantic sign-in fields before scripts populate their values", () => {
  const username = {
    type: "text",
    value: "",
    autocomplete: "username",
    name: "username",
    readOnly: true
  };
  const revealedPassword = {
    type: "text",
    value: "",
    autocomplete: "current-password",
    name: "password"
  };

  assert.equal(detector.fieldNeedsBlur(username), true);
  assert.equal(detector.fieldNeedsBlur(revealedPassword), true);
});

test("uses explicit, wrapping, ARIA and table labels for field semantics", () => {
  const labelsById = new Map([
    ["dob-label", { textContent: "Date of birth" }],
    ["pin-label", { textContent: "Security PIN" }]
  ]);
  const ownerDocument = {
    getElementById(id) {
      return labelsById.get(id) ?? null;
    }
  };
  const fixtures = [
    {
      type: "text",
      value: "",
      labels: [{ textContent: "Passport number" }]
    },
    {
      type: "text",
      value: "",
      ownerDocument,
      getAttribute(name) {
        return name === "aria-labelledby" ? "dob-label pin-label" : null;
      }
    },
    {
      type: "text",
      value: "",
      closest() {
        return {
          parentElement: {
            querySelectorAll() {
              return [{ textContent: "Bank account" }];
            }
          }
        };
      }
    }
  ];

  fixtures.forEach((field) => assert.equal(detector.fieldNeedsBlur(field), true));
});

test("treats sensitive contenteditable regions like local text fields", () => {
  assert.equal(
    detector.fieldNeedsBlur({
      type: "text",
      textContent: "alex@example.com",
      getAttribute(name) {
        return name === "contenteditable" ? "true" : null;
      }
    }),
    true
  );
});

test("classifies generic static personal-detail labels and metadata", () => {
  const fixtures = [
    ["display-name-field Display name", "name"],
    ["full_name Full name", "name"],
    ["gender-field Gender", "demographic"],
    ["preferred-pronouns Pronouns", "demographic"],
    ["year-of-birth-field Year of birth", "birth-date"],
    ["date_of_birth Date of birth", "birth-date"],
    ["postcode-field Postcode", "address"],
    ["postal_address Home address", "address"]
  ];

  for (const [context, expectedType] of fixtures) {
    assert.equal(detector.sensitiveSemanticType(context), expectedType, context);
  }
  for (const context of [
    "Passport number",
    "Driving licence",
    "Tax ID",
    "IBAN",
    "Sort code",
    "Bank account",
    "PIN",
    "API key",
    "Access token",
    "Security answer"
  ]) {
    assert.notEqual(detector.sensitiveSemanticType(context), null, context);
  }
});

test("does not classify generic account actions as static personal values", () => {
  const contexts = [
    "Personal details",
    "Delete your account",
    "Edit profile",
    "Account settings",
    "Sign in without a password"
  ];

  for (const context of contexts) {
    assert.equal(detector.sensitiveSemanticType(context), null, context);
  }
});

function loadDetector() {
  const context = vm.createContext({});
  const source = fs.readFileSync(
    path.join(__dirname, "..", "lib", "pii-detector.js"),
    "utf8"
  );
  vm.runInContext(source, context);
  return context.BlurPiiDetector;
}
