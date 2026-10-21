import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Diagnostics "../src/backend/lib/call-diagnostics";
import Types "../src/backend/types/calls";

let input : Types.CallDiagnosticsInput = {
  version = 1;
  bridgeVersion = "test-bridge";
  transportStatus = "completed";
  terminationReason = "remote_hangup";
  connected = true;
  callerAudioBytes = 8_000;
  assistantAudioBytes = 8_000;
  assistantSuppressedBytes = 0;
  assistantConfirmedTurns = 1;
  assistantUnconfirmedTurns = 0;
};

func repeatedText(count : Nat) : Text {
  var text = "";
  for (_ in Nat.range(0, count)) { text #= "x" };
  text;
};

// Audio evidence describes transport only. Even two-way confirmed playback
// cannot establish whether an automated service answered the caller's question.
assert Diagnostics.outcome(input) == #audioExchanged;
assert Diagnostics.outcome({ input with connected = false }) == #notConnected;
assert Diagnostics.outcome({ input with connected = false; assistantAudioBytes = 0; assistantConfirmedTurns = 0 }) == #notConnected;
assert Diagnostics.outcome({ input with assistantAudioBytes = 0; assistantSuppressedBytes = 80_000; assistantUnconfirmedTurns = 2 }) == #noAssistantAudio;
assert Diagnostics.outcome({ input with assistantConfirmedTurns = 0; assistantUnconfirmedTurns = 1 }) == #playbackUnconfirmed;
assert Diagnostics.outcome({ input with callerAudioBytes = 0; assistantConfirmedTurns = 0 }) == #playbackUnconfirmed;
assert Diagnostics.outcome({ input with callerAudioBytes = 0 }) == #unknown;
assert Diagnostics.callStatus(null) == #completed;
assert Diagnostics.callStatus(?input) == #completed;
assert Diagnostics.callStatus(?{ input with connected = false }) == #failed;
for (transportStatus in ["failed", "busy", "no-answer", "canceled"].values()) {
  assert Diagnostics.callStatus(?{ input with transportStatus }) == #failed;
};

// Accept every inclusive boundary, and reject each independent field above it.
let boundaries = {
  input with
  bridgeVersion = repeatedText(80);
  transportStatus = repeatedText(30);
  terminationReason = repeatedText(120);
  callerAudioBytes = 1_000_000_000;
  assistantAudioBytes = 1_000_000_000;
  assistantSuppressedBytes = 1_000_000_000;
  assistantConfirmedTurns = 100_000;
  assistantUnconfirmedTurns = 100_000;
};
assert Diagnostics.valid(boundaries);
let invalidInputs : [Types.CallDiagnosticsInput] = [
  { input with version = 0 },
  { input with version = 2 },
  { input with bridgeVersion = repeatedText(81) },
  { input with transportStatus = repeatedText(31) },
  { input with terminationReason = repeatedText(121) },
  { input with callerAudioBytes = 1_000_000_001 },
  { input with assistantAudioBytes = 1_000_000_001 },
  { input with assistantSuppressedBytes = 1_000_000_001 },
  { input with assistantConfirmedTurns = 100_001 },
  { input with assistantUnconfirmedTurns = 100_001 },
];
let invalidState = Diagnostics.initState();
for (invalid in invalidInputs.values()) {
  assert not Diagnostics.valid(invalid);
  assert not Diagnostics.save(invalidState, 1, invalid);
};
assert invalidState.entries.size() == 0;

// Finalization retries replace one entry and preserve the server-derived
// outcome. Invalid retries cannot erase a previously saved diagnostic.
let retries = Diagnostics.initState();
assert Diagnostics.get(retries, 42) == null;
assert Diagnostics.save(retries, 42, input);
for (turns in Nat.range(1, 20)) {
  assert Diagnostics.save(retries, 42, { input with assistantConfirmedTurns = turns });
  assert retries.entries.size() == 1;
};
assert not Diagnostics.save(retries, 42, { input with version = 2 });
switch (Diagnostics.get(retries, 42)) {
  case null { assert false };
  case (?saved) {
    assert saved.assistantConfirmedTurns == 19;
    assert saved.outcome == #audioExchanged;
    assert saved.bridgeVersion == input.bridgeVersion;
  };
};

// Retention is bounded by call ID, not retry arrival time. Recovering an older
// call must never evict newer diagnostics or permanently prevent a new call.
let retention = Diagnostics.initState();
for (id in Nat.range(10, 10 + Diagnostics.MAX_RECORDS)) {
  assert Diagnostics.save(retention, id, input);
};
assert retention.entries.size() == Diagnostics.MAX_RECORDS;
let newest = 10 + Diagnostics.MAX_RECORDS;
assert Diagnostics.save(retention, newest, input);
assert retention.entries.size() == Diagnostics.MAX_RECORDS;
assert Diagnostics.get(retention, 10) == null;
assert Diagnostics.get(retention, 11) != null;
assert not Diagnostics.save(retention, 1, input);
assert not Diagnostics.save(retention, 10, input);
assert Diagnostics.get(retention, newest) != null;
assert Diagnostics.get(retention, 11) != null;
assert Diagnostics.save(retention, 11, { input with assistantConfirmedTurns = 2 });
assert retention.entries.size() == Diagnostics.MAX_RECORDS;
assert Diagnostics.save(retention, newest + 1, input);
assert Diagnostics.get(retention, 11) == null;
assert Diagnostics.get(retention, 12) != null;
assert Diagnostics.get(retention, newest + 1) != null;
assert retention.entries.size() == Diagnostics.MAX_RECORDS;
