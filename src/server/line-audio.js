// Local mulaw analysis for outbound calls. No transcripts, network calls, or IC writes.
const SAMPLE_RATE = 8000;
const FRAME = 320; // 40 ms
const BEEP_FREQUENCIES = [440, 480, 620, 697, 770, 852, 941, 1000, 1100, 1209, 1336, 1400, 1477];

export function decodeMuLawSample(byte) {
  const value = (~byte) & 0xff;
  const magnitude = (((value & 0x0f) << 3) + 132) << ((value >> 4) & 0x07);
  return (value & 0x80) ? 132 - magnitude : magnitude - 132;
}

function goertzelPower(samples, frequency) {
  const n = samples.length;
  const coeff = 2 * Math.cos((2 * Math.PI * frequency) / SAMPLE_RATE);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

export function classifyToneFrame(samples) {
  if (!samples || samples.length < FRAME) return null;
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
  const rms = Math.sqrt(energy / samples.length);
  if (rms < 450) return { tone: false, rms };
  const powers = BEEP_FREQUENCIES.map((frequency) => ({
    frequency,
    power: goertzelPower(samples, frequency),
  })).sort((a, b) => b.power - a.power);
  const best = powers[0];
  const second = powers[1];
  const purity = best.power / (energy || 1);
  const tone = purity > 0.45 && best.power > second.power * 3.2 && best.frequency >= 420 && best.frequency <= 1450;
  return { tone, frequency: best.frequency, rms, purity };
}

export function createLineListener({ onBeep, now = Date.now } = {}) {
  let pending = Buffer.alloc(0);
  let run = 0;
  let runFrequency = 0;
  let cooledUntil = 0;
  let suspendedUntil = 0;

  function reset() {
    pending = Buffer.alloc(0);
    run = 0;
    runFrequency = 0;
  }

  return {
    push(payload) {
      if (typeof payload !== "string" || !payload) return;
      if (now() < suspendedUntil) {
        reset();
        return;
      }
      const chunk = Buffer.from(payload, "base64");
      if (chunk.length === 0) return;
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      if (pending.length > 8000) pending = pending.subarray(pending.length - 8000);
      while (pending.length >= FRAME) {
        const frame = pending.subarray(0, FRAME);
        pending = pending.subarray(FRAME);
        const samples = new Array(FRAME);
        for (let i = 0; i < FRAME; i++) samples[i] = decodeMuLawSample(frame[i]);
        const found = classifyToneFrame(samples);
        if (!found?.tone || Math.abs(found.frequency - runFrequency) > 70) {
          run = found?.tone ? 1 : 0;
          runFrequency = found?.tone ? found.frequency : 0;
          continue;
        }
        run += 1;
        if (run >= 6 && now() >= cooledUntil) {
          cooledUntil = now() + 2500;
          run = 0;
          onBeep?.({ frequency: runFrequency });
        }
      }
    },
    suspend(ms) {
      suspendedUntil = now() + Math.max(0, Number(ms) || 0);
      reset();
    },
  };
}
