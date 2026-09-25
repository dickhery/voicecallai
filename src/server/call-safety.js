import { isEmergencyDestination, EMERGENCY_BLOCKED_MESSAGE } from './emergency-numbers.js';

// Exact E.164 entries only. Invalid operator configuration must fail closed.
export function parseBlockedDestinations(value = '') {
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (entries.some((entry) => !/^\+[1-9]\d{7,14}$/.test(entry))) {
    throw new Error('BLOCKED_OUTBOUND_NUMBERS must contain comma-separated E.164 numbers.');
  }
  return new Set(entries);
}

export function assertAllowedDestination(phone, blocked = new Set()) {
  if (isEmergencyDestination(phone) || blocked.has(phone)) {
    const error = new Error(EMERGENCY_BLOCKED_MESSAGE);
    error.code = 'EMERGENCY_NUMBER_BLOCKED';
    throw error;
  }
  // Never let Twilio interpret dial strings, extensions, URI parameters, or
  // punctuation differently from the destination checked by the canister.
  if (typeof phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(phone)) {
    const error = new Error('An exact E.164 destination is required.');
    error.code = 'INVALID_PHONE_NUMBER';
    throw error;
  }
}

export const OFFICIAL_IMPERSONATION_RULES = [
  {
    category: 'official impersonation',
    pattern: /\b(?:impersonate|pretend to be|pose as|act as|you are)\b.{0,60}\b(?:police|a cop|an officer|the fbi|the irs|the cia|ice|sheriff|a marshal|a judge|the court|a government official|911 dispatcher|emergency services)\b/gi,
  },
];

export const MINOR_SEXUAL_RULES = [
  {
    category: 'sexual content involving minors',
    pattern: /\b(?:child|children|minor|minors|underage|preteen|toddler|infant)\b.{0,50}\b(?:sex|sexual|nude|naked|porn|explicit)\b/gi,
  },
  {
    category: 'sexual content involving minors',
    pattern: /\b(?:[1-9]|1[0-7])\s*(?:year|yr)s?\s*old\b.{0,40}\b(?:sex|sexual|nude|naked|porn)\b/gi,
  },
];

export const FALSE_REPORT_RULES = [
  { category: 'false emergency reports', pattern: /\b(?:swatting|swat)\b/gi },
  { category: 'false emergency reports', pattern: /\b(?:fake|false|fabricate|invent|pretend|hoax)\b.{0,100}\b(?:emergency|bomb|hostage|shooting|crime|police report|dispatch)\b/gi },
  { category: 'false emergency reports', pattern: /\b(?:send|dispatch|summon)\b.{0,60}\b(?:police|swat team|armed officers)\b/gi },
];

export function findRuleViolation(text, rules) {
  const normalized = String(text || '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  for (const rule of rules) {
    // Scan every occurrence: a harmless negated example cannot hide a later
    // harmful instruction matching the same rule. Avoid shared RegExp state.
    const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`;
    for (const match of normalized.matchAll(new RegExp(rule.pattern.source, flags))) {
      const before = normalized.slice(Math.max(0, match.index - 36), match.index);
      if (/\b(?:do not|don't|dont|never|avoid|refuse|stop|prevent|block|moderate|without|not)\b[\s.:;,-]*$/i.test(before)) continue;
      return { category: rule.category, phrase: match[0].slice(0, 120) };
    }
  }
  return null;
}
