import Array "mo:core/Array";
import Text "mo:core/Text";

/// Blocks outbound calls to emergency, crisis, and non-emergency police
/// dispatch short codes. Pure, allocation-light matching — no stable maps
/// and no inter-canister calls — so rejected attempts stay cheap on cycles.
module {
  public let BLOCKED_MESSAGE : Text = "Calls to emergency services, crisis lines, and non-emergency police dispatch numbers are not allowed. Use a local phone for those numbers.";

  // Exact national short codes. Compared only against the full digit string
  // or the remainder after a 1–3 digit country calling code.
  private let SHORT_2 : [Text] = ["15", "17", "18"];
  private let SHORT_3 : [Text] = [
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
  ];
  private let SHORT_4 : [Text] = ["1669", "1911"];
  private let SHORT_5 : [Text] = ["10111", "10177"];

  public func isBlockedDestination(phoneNumber : Text) : Bool {
    let digits = phoneNumber.toArray().filter(func c = c >= '0' and c <= '9');
    if (digits.size() < 2) {
      return false;
    };
    isBlockedDigits(digits);
  };

  private func listedIn(codes : [Text], code : Text) : Bool {
    for (item in codes.values()) {
      if (item == code) {
        return true;
      };
    };
    false;
  };

  private func isListedShortCode(code : Text) : Bool {
    switch (code.size()) {
      case 2 { listedIn(SHORT_2, code) };
      case 3 { listedIn(SHORT_3, code) };
      case 4 { listedIn(SHORT_4, code) };
      case 5 { listedIn(SHORT_5, code) };
      case _ { false };
    };
  };

  private func sliceToText(chars : [Char], start : Nat, end : Nat) : Text {
    if (start >= chars.size() or end > chars.size() or start >= end) {
      return "";
    };
    Text.fromArray(chars.sliceToArray(start, end));
  };

  /// Short emergency code with 1–3 digits of trailing padding (911000, 11200).
  /// Only applied to 4–6 digit remainders so full subscriber numbers are kept.
  private func isPaddedEmergency(chars : [Char], start : Nat) : Bool {
    let n = chars.size();
    if (start + 4 > n or start + 7 <= n) {
      return false;
    };
    var prefixLen = 3;
    while (prefixLen <= 5 and start + prefixLen < n) {
      if (isListedShortCode(sliceToText(chars, start, start + prefixLen))) {
        return true;
      };
      prefixLen += 1;
    };
    false;
  };

  private func isN11(a : Char, b : Char, c : Char) : Bool {
    a >= '2' and a <= '9' and b == '1' and c == '1';
  };

  private func isBlockedNanpCode(a : Char, b : Char, c : Char, isNpa : Bool) : Bool {
    if (isN11(a, b, c) or (a == '9' and b == '3' and c == '3')) {
      return true;
    };
    if (isNpa) {
      return (a == '9' and b == '8' and c == '8') or
      (a == '9' and b == '9' and c == '9') or
      (a == '1' and b == '1' and (c == '0' or c == '1' or c == '2' or c == '9'));
    };
    a == '1' and b == '1' and (c == '0' or c == '1' or c == '2' or c == '9');
  };

  /// NANP 10-digit national numbers: reserved N11 / 911 / 933 NPAs and exchanges.
  /// 988 is blocked as an NPA (crisis line) but not as an NXX (real numbers exist).
  private func isBlockedNanp(chars : [Char], npaStart : Nat) : Bool {
    if (npaStart + 6 > chars.size()) {
      return false;
    };
    let npaA = chars[npaStart];
    let npaB = chars[npaStart + 1];
    let npaC = chars[npaStart + 2];
    if (isBlockedNanpCode(npaA, npaB, npaC, true)) {
      return true;
    };
    let nxxA = chars[npaStart + 3];
    let nxxB = chars[npaStart + 4];
    let nxxC = chars[npaStart + 5];
    isBlockedNanpCode(nxxA, nxxB, nxxC, false);
  };

  private func remainderIsEmergency(chars : [Char], start : Nat) : Bool {
    let rest = sliceToText(chars, start, chars.size());
    isListedShortCode(rest) or isPaddedEmergency(chars, start);
  };

  private func isBlockedDigits(chars : [Char]) : Bool {
    if (isListedShortCode(Text.fromArray(chars)) or isPaddedEmergency(chars, 0)) {
      return true;
    };

    let n = chars.size();
    if (n == 11 and chars[0] == '1' and isBlockedNanp(chars, 1)) {
      return true;
    };
    if (n == 10 and chars[0] >= '2' and chars[0] <= '9' and isBlockedNanp(chars, 0)) {
      return true;
    };

    var prefixLen = 1;
    while (prefixLen <= 3) {
      if (n > prefixLen and remainderIsEmergency(chars, prefixLen)) {
        return true;
      };
      prefixLen += 1;
    };
    false;
  };
};
