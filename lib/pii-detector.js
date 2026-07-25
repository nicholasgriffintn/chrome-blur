(function initialiseBlurPiiDetector(global) {
  "use strict";

  const EMAIL_PATTERN = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/giu;
  const PAYMENT_CARD_PATTERN = /\b(?:\d[ -]?){12,18}\d\b/gu;
  const IBAN_PATTERN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/giu;
  const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu;
  const NATIONAL_INSURANCE_PATTERN = /\b[A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/giu;
  const SOCIAL_SECURITY_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/gu;
  const PHONE_PATTERN = /(?:\+\d[\d ().-]{5,}\d|\d{2,4}(?:[ ().-]\d{2,5}){2,4}|\b0\d{9,10}\b)/gu;
  const UK_POSTCODE_PATTERN = /\b(?:GIR ?0AA|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})\b/giu;
  const STREET_ADDRESS_PATTERN = new RegExp(
    String.raw`\b\d{1,6}\s+[\p{L}\p{N}.'’/-]+` +
      String.raw`(?:\s+[\p{L}\p{N}.'’/-]+){0,4}\s+` +
      String.raw`(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|` +
      String.raw`boulevard|blvd|way|close|court|ct|place|pl|terrace|crescent)\b`,
    "giu"
  );
  const CONTEXTUAL_PATTERNS = Object.freeze([
    Object.freeze({
      type: "name",
      pattern: /\b(?:(?:display|full|first|last|preferred)\s+)?name\s*[:=–—-]\s*([\p{L}\p{M}.'’/-]+(?:\s+[\p{L}\p{M}.'’/-]+){0,4})/giu
    }),
    Object.freeze({
      type: "birth-date",
      pattern: /\b(?:date|year)\s+of\s+birth\s*[:=–—-]\s*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/. -]\d{1,2}[/. -]\d{2,4}|\d{1,2}\s+\p{L}+\s+\d{4}|\d{4})/giu
    }),
    Object.freeze({
      type: "financial-account",
      pattern: /\b(?:sort code|bank account|account number|routing number)\s*[:=–—-]\s*([A-Z0-9][A-Z0-9 -]{4,33})/giu
    }),
    Object.freeze({
      type: "identity-number",
      pattern: /\b(?:passport(?: number)?|driving licen[cs]e|driver(?:'s)? licen[cs]e|tax id)\s*[:=–—-]\s*([A-Z0-9][A-Z0-9 -]{4,30})/giu
    }),
    Object.freeze({
      type: "credential",
      pattern: /\b(?:pin|secret|api key|access token|security answer)\s*[:=–—-]\s*([^\n;|]{2,80})/giu
    }),
    Object.freeze({
      type: "demographic",
      pattern: /\b(?:gender|sex|pronouns?)\s*[:=–—-]\s*([\p{L}\p{M}][\p{L}\p{M} '-]{1,40})/giu
    }),
    Object.freeze({
      type: "address",
      pattern: /\b(?:(?:home|postal|billing|shipping)\s+)?address\s*[:=–—-]\s*([^\n;|]{5,160})/giu
    })
  ]);
  const INVALID_NATIONAL_INSURANCE_PREFIXES = new Set([
    "BG", "GB", "KN", "NK", "NT", "TN", "ZZ"
  ]);
  const DATE_PATTERNS = Object.freeze([
    /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/u,
    /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/u
  ]);
  const SENSITIVE_AUTOCOMPLETE_TOKENS = new Set([
    "name", "honorific-prefix", "given-name", "additional-name", "family-name",
    "honorific-suffix", "nickname",
    "email", "username", "new-password", "current-password", "one-time-code",
    "street-address", "address-line1", "address-line2", "address-line3",
    "address-level1", "address-level2", "address-level3", "address-level4",
    "country", "country-name", "postal-code",
    "cc-name", "cc-given-name", "cc-additional-name", "cc-family-name",
    "cc-number", "cc-exp", "cc-exp-month", "cc-exp-year", "cc-csc",
    "bday", "bday-day", "bday-month", "bday-year", "sex",
    "tel", "tel-country-code", "tel-national", "tel-area-code", "tel-local"
  ]);
  const NON_TEXT_FIELD_TYPES = new Set([
    "button", "checkbox", "color", "file", "hidden", "image", "radio",
    "range", "reset", "submit"
  ]);
  const SEMANTIC_PATTERNS = Object.freeze([
    ["email", /\b(?:e mail|email)(?:\s+(?:address|field|input|value))?\b/u],
    ["phone", /\b(?:phone|telephone|mobile)(?:\s+(?:number|field|input|value))?\b/u],
    [
      "payment-card",
      /\b(?:credit card|card number|cc number)\b/u
    ],
    [
      "financial-account",
      /\b(?:bank account|account number|routing number|sort code)\b/u
    ],
    [
      "iban",
      /\biban\b/u
    ],
    [
      "identity-number",
      /\b(?:social security|ssn|national insurance|passport|tax id|driving licen[cs]e|driver(?:s)? licen[cs]e)\b/u
    ],
    [
      "birth-date",
      /\b(?:(?:date|year) of birth|birth(?:\s+date|\s+year|date)|dob|bday)\b/u
    ],
    [
      "demographic",
      /\b(?:gender|sex|pronouns?|gender identity)\b/u
    ],
    [
      "address",
      /\b(?:address|street|postcode|postal code|zip code)\b/u
    ],
    [
      "name",
      /\b(?:(?:display|full|first|last|given|family|preferred)\s+name|nickname)\b/u
    ],
    ["name", /^(?:name|name field|name input|name value)$/u],
    [
      "credential",
      /^(?:username|user name|password|passcode|pin|secret|api key|access token|security answer)(?:\s+(?:field|input|value))?$/u
    ],
    [
      "credential",
      /\b(?:username|user name|password|passcode|pin|secret|api key|access token|security answer)\s+(?:field|input|value)\b/u
    ]
  ]);

  function findSensitiveRanges(value) {
    const text = String(value ?? "");
    if (!text) return [];

    const ranges = [
      ...collectMatches(text, EMAIL_PATTERN, "email"),
      ...collectValidatedMatches(
        text,
        NATIONAL_INSURANCE_PATTERN,
        "identity-number",
        isNationalInsuranceNumber
      ),
      ...collectMatches(text, SOCIAL_SECURITY_PATTERN, "identity-number"),
      ...collectValidatedMatches(text, PAYMENT_CARD_PATTERN, "payment-card", isPaymentCard),
      ...collectIbanMatches(text),
      ...collectValidatedMatches(text, IPV4_PATTERN, "ip-address", isSensitiveIpv4Address),
      ...collectValidatedMatches(text, PHONE_PATTERN, "phone", isLikelyPhone),
      ...collectMatches(text, UK_POSTCODE_PATTERN, "address"),
      ...collectMatches(text, STREET_ADDRESS_PATTERN, "address"),
      ...collectContextualMatches(text)
    ];

    ranges.sort((first, second) =>
      first.start - second.start ||
      second.end - first.end ||
      first.type.localeCompare(second.type)
    );
    return mergeOverlappingRanges(ranges);
  }

  function fieldNeedsBlur(field) {
    const type = String(field?.type ?? "text").toLowerCase();
    if (type === "password") return true;
    if (NON_TEXT_FIELD_TYPES.has(type)) return false;
    if (type === "email" || type === "tel") return true;

    const autocompleteTokens = String(field?.autocomplete ?? "")
      .toLowerCase()
      .split(/\s+/u);
    if (autocompleteTokens.some((token) => SENSITIVE_AUTOCOMPLETE_TOKENS.has(token))) {
      return true;
    }

    const semanticHint = getFieldSemanticHint(field);
    if (sensitiveSemanticType(semanticHint)) return true;

    const value = String(field?.value ?? field?.textContent ?? "");
    if (!value) return false;
    return findSensitiveRanges(value).length > 0;
  }

  function getFieldSemanticHint(field) {
    const labels = [...(field?.labels ?? [])].map((label) => label.textContent);
    const labelledBy = resolveReferencedText(
      field,
      field?.getAttribute?.("aria-labelledby")
    );
    const cell = field?.closest?.("td, th");
    const row = cell?.closest?.("tr") ?? cell?.parentElement;
    const tableHeadings = [...(row?.querySelectorAll?.("th") ?? [])]
      .map((heading) => heading.textContent);
    const headerText = resolveReferencedText(field, cell?.getAttribute?.("headers"));

    return [
      field?.name,
      field?.id,
      field?.getAttribute?.("aria-label"),
      field?.getAttribute?.("placeholder"),
      ...labels,
      ...labelledBy,
      ...tableHeadings,
      ...headerText
    ].filter(Boolean).join(" ");
  }

  function sensitiveSemanticType(value) {
    const text = String(value ?? "")
      .normalize("NFKC")
      .replace(/([a-z])([A-Z])/gu, "$1 $2")
      .toLowerCase()
      .replace(/[_-]+/gu, " ")
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    if (!text) return null;

    return SEMANTIC_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
  }

  function collectMatches(text, pattern, type) {
    return [...text.matchAll(pattern)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
      type
    }));
  }

  function collectValidatedMatches(text, pattern, type, validate) {
    return [...text.matchAll(pattern)]
      .filter((match) => validate(match[0]))
      .map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
        type
      }));
  }

  function collectContextualMatches(text) {
    return CONTEXTUAL_PATTERNS.flatMap(({ pattern, type }) =>
      [...text.matchAll(pattern)].map((match) => {
        const value = match[1];
        const offset = match[0].lastIndexOf(value);
        return {
          start: match.index + offset,
          end: match.index + offset + value.length,
          type
        };
      })
    );
  }

  function collectIbanMatches(text) {
    return [...text.matchAll(IBAN_PATTERN)].flatMap((match) => {
      for (let end = 15; end <= match[0].length; end += 1) {
        if (!/[A-Z0-9]/iu.test(match[0][end - 1])) continue;
        const candidate = match[0].slice(0, end);
        if (!isIban(candidate)) continue;
        return [{
          start: match.index,
          end: match.index + end,
          type: "iban"
        }];
      }
      return [];
    });
  }

  function mergeOverlappingRanges(ranges) {
    const merged = [];

    for (const range of ranges) {
      const previous = merged.at(-1);
      if (!previous || range.start >= previous.end) {
        merged.push(Object.freeze({ ...range }));
        continue;
      }

      if (range.end > previous.end) {
        merged[merged.length - 1] = Object.freeze({
          start: previous.start,
          end: range.end,
          type: previous.type
        });
      }
    }

    return Object.freeze(merged);
  }

  function isPaymentCard(value) {
    const digits = digitsOnly(value);
    if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/u.test(digits)) return false;

    let sum = 0;
    let shouldDouble = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index]);
      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      shouldDouble = !shouldDouble;
    }
    return sum % 10 === 0;
  }

  function isIban(value) {
    const iban = value.replace(/\s+/gu, "").toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/u.test(iban)) return false;

    const rearranged = iban.slice(4) + iban.slice(0, 4);
    const numeric = rearranged.replace(/[A-Z]/gu, (letter) =>
      String(letter.charCodeAt(0) - 55)
    );
    let remainder = 0;
    for (const digit of numeric) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
    return remainder === 1;
  }

  function isNationalInsuranceNumber(value) {
    const number = value.replace(/\s+/gu, "").toUpperCase();
    if (!/^[A-Z]{2}\d{6}[A-D]$/u.test(number)) return false;

    const [first, second] = number;
    if ("DFIQUV".includes(first) || "DFIOQUV".includes(second)) return false;
    return !INVALID_NATIONAL_INSURANCE_PREFIXES.has(number.slice(0, 2));
  }

  function isIpv4Address(value) {
    return value.split(".").every((octet) => {
      const number = Number(octet);
      return /^\d{1,3}$/u.test(octet) && number >= 0 && number <= 255;
    });
  }

  function isSensitiveIpv4Address(value) {
    if (!isIpv4Address(value)) return false;
    const [first, second, third] = value.split(".").map(Number);

    if (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    ) {
      return false;
    }
    if (
      (first === 192 && second === 0 && third === 2) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113)
    ) {
      return false;
    }
    return true;
  }

  function isLikelyPhone(value) {
    const candidate = value.trim();
    const digits = digitsOnly(candidate);
    if (digits.length < 7 || digits.length > 15) return false;
    if (DATE_PATTERNS.some((pattern) => pattern.test(candidate))) return false;
    if (/^\d{3}-\d{2}-\d{4}$/u.test(candidate)) return false;
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(candidate) && isIpv4Address(candidate)) return false;
    if (digits.length >= 13 && isPaymentCard(candidate)) return false;
    if (/^\d+$/u.test(candidate)) return /^0[1-9]\d{8,9}$/u.test(candidate);
    const groups = candidate.replace(/^\+\d{1,3}\s*/u, "").split(/\D+/u).filter(Boolean);
    if (!candidate.startsWith("+") && groups.at(-1)?.length < 3) return false;
    return candidate.startsWith("+") || /[ ().-]/u.test(candidate);
  }

  function resolveReferencedText(field, value) {
    return String(value ?? "")
      .split(/\s+/u)
      .filter(Boolean)
      .map((id) => field?.ownerDocument?.getElementById?.(id)?.textContent)
      .filter(Boolean);
  }

  function digitsOnly(value) {
    return String(value ?? "").replace(/\D/gu, "");
  }

  global.BlurPiiDetector = Object.freeze({
    findSensitiveRanges,
    fieldNeedsBlur,
    getFieldSemanticHint,
    sensitiveSemanticType
  });
})(globalThis);
