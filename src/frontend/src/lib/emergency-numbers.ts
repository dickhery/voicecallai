/**
 * Client-side mirror of src/backend/lib/emergency.mo.
 * Blocks the update call (and its cycles) when the destination is an
 * emergency, crisis, or non-emergency police dispatch number. The canister
 * remains the security boundary.
 */

export const EMERGENCY_BLOCKED_MESSAGE =
  "Calls to emergency services, crisis lines, and non-emergency police dispatch numbers are not allowed. Use a local phone for those numbers.";

const SHORT_2 = new Set(["15", "17", "18"]);
const SHORT_3 = new Set([
  "000",
  "066",
  "088",
  "100",
  "101",
  "102",
  "103",
  "108",
  "110",
  "111",
  "112",
  "113",
  "114",
  "115",
  "117",
  "118",
  "119",
  "120",
  "122",
  "133",
  "144",
  "190",
  "191",
  "192",
  "193",
  "199",
  "211",
  "311",
  "411",
  "511",
  "611",
  "711",
  "811",
  "911",
  "933",
  "988",
  "995",
  "999",
]);
const SHORT_4 = new Set(["1669", "1911"]);
const SHORT_5 = new Set(["10111", "10177"]);

function digitsOnly(phone: string): string {
  return String(phone || "").replace(/\D/g, "");
}

function isListedShortCode(code: string): boolean {
  switch (code.length) {
    case 2:
      return SHORT_2.has(code);
    case 3:
      return SHORT_3.has(code);
    case 4:
      return SHORT_4.has(code);
    case 5:
      return SHORT_5.has(code);
    default:
      return false;
  }
}

function isPaddedEmergency(digits: string, start = 0): boolean {
  const rest = digits.slice(start);
  if (rest.length < 4 || rest.length > 6) return false;
  for (
    let prefixLen = 3;
    prefixLen <= 5 && prefixLen < rest.length;
    prefixLen += 1
  ) {
    if (isListedShortCode(rest.slice(0, prefixLen))) return true;
  }
  return false;
}

function isN11(code: string): boolean {
  return /^[2-9]11$/.test(code);
}

function isBlockedNanpCode(code: string, isNpa: boolean): boolean {
  if (isN11(code) || code === "933") return true;
  if (isNpa) {
    return (
      code === "988" ||
      code === "999" ||
      code === "110" ||
      code === "111" ||
      code === "112" ||
      code === "119"
    );
  }
  return code === "110" || code === "111" || code === "112" || code === "119";
}

function isBlockedNanp(digits: string, npaStart: number): boolean {
  const npa = digits.slice(npaStart, npaStart + 3);
  const nxx = digits.slice(npaStart + 3, npaStart + 6);
  if (npa.length !== 3 || nxx.length !== 3) return false;
  return isBlockedNanpCode(npa, true) || isBlockedNanpCode(nxx, false);
}

function remainderIsEmergency(digits: string, start: number): boolean {
  const rest = digits.slice(start);
  return isListedShortCode(rest) || isPaddedEmergency(digits, start);
}

export function isEmergencyDestination(phone: string): boolean {
  const digits = digitsOnly(phone);
  if (digits.length < 2) return false;
  if (isListedShortCode(digits) || isPaddedEmergency(digits, 0)) return true;
  if (digits.length === 11 && digits[0] === "1" && isBlockedNanp(digits, 1)) {
    return true;
  }
  if (
    digits.length === 10 &&
    digits[0] >= "2" &&
    digits[0] <= "9" &&
    isBlockedNanp(digits, 0)
  ) {
    return true;
  }
  for (let prefixLen = 1; prefixLen <= 3; prefixLen += 1) {
    if (digits.length > prefixLen && remainderIsEmergency(digits, prefixLen)) {
      return true;
    }
  }
  return false;
}
