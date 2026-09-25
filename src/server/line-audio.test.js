import test from "node:test";
import assert from "node:assert/strict";
import { createLineListener } from "./line-audio.js";

function encodeMuLaw(sample) {
  const sign = sample < 0 ? 0x80 : 0;
  const magnitude = Math.min(32635, Math.abs(Math.round(sample))) + 132;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && !(magnitude & mask); mask >>= 1) exponent--;
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function frames(samples) {
  const bytes = Buffer.alloc(samples.length);
  samples.forEach((sample, index) => { bytes[index] = encodeMuLaw(sample); });
  return bytes.toString("base64");
}

function tone(frequency, ms, amplitude = 9000) {
  const count = Math.round(8000 * ms / 1000);
  const samples = Array.from({ length: count }, (_, i) =>
    amplitude * Math.sin(2 * Math.PI * frequency * i / 8000));
  return frames(samples);
}

function mix(parts, ms) {
  const count = Math.round(8000 * ms / 1000);
  const samples = Array.from({ length: count }, (_, i) =>
    parts.reduce((sum, [frequency, amplitude]) =>
      sum + amplitude * Math.sin(2 * Math.PI * frequency * i / 8000), 0));
  return frames(samples);
}

function listen() {
  const beeps = [];
  let time = 0;
  const line = createLineListener({ onBeep: (event) => beeps.push(event), now: () => time });
  return { line, beeps, advance: (ms) => { time += ms; } };
}

test("a sustained single tone is a voicemail beep and speech or dual tones are not", () => {
  const beep = listen();
  beep.line.push(tone(1000, 400));
  assert.equal(beep.beeps.length, 1);
  assert.equal(beep.beeps[0].frequency, 1000);

  const speech = listen();
  speech.line.push(mix([[220, 2500], [340, 1800], [510, 1200], [980, 700]], 800));
  assert.equal(speech.beeps.length, 0);

  const dtmf = listen();
  dtmf.line.push(mix([[697, 7000], [1209, 7000]], 500));
  assert.equal(dtmf.beeps.length, 0);

  const blip = listen();
  blip.line.push(tone(1000, 80));
  assert.equal(blip.beeps.length, 0);
});

test("beep detection pauses while keypad tones may echo", () => {
  const h = listen();
  h.line.suspend(1000);
  h.line.push(tone(1000, 400));
  assert.equal(h.beeps.length, 0);
  h.advance(1000);
  h.line.push(tone(852, 400));
  assert.equal(h.beeps.length, 1);
});
