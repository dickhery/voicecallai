export function renderLiveAudioPage(sessionId) {
  const serializedSessionId = JSON.stringify(String(sessionId)).replace(
    /</g,
    "\\u003c",
  );
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>VoiceCall AI — Live Call Audio</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #070b14; color: #f7f8fb; }
    main { width: min(92vw, 34rem); padding: 2rem; border: 1px solid #25304a; border-radius: 1rem; background: #101726; box-shadow: 0 1.5rem 5rem #0008; }
    h1 { margin: 0 0 .7rem; font-size: 1.55rem; }
    p { color: #b8c2d9; line-height: 1.55; }
    button { width: 100%; margin-top: 1rem; padding: .85rem 1rem; border: 0; border-radius: .7rem; background: #6d5dfc; color: white; font: inherit; font-weight: 700; cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: .6; }
    #status { min-height: 1.5rem; margin-top: 1rem; color: #9de6bf; }
    .note { font-size: .9rem; }
  </style>
</head>
<body>
  <main>
    <h1>Live call audio</h1>
    <p>This is a listen-only stream of the active VoiceCall AI phone call. It cannot steer or end the call.</p>
    <button id="listen" type="button">Start listening</button>
    <div id="status" role="status" aria-live="polite">Ready to connect.</div>
    <p class="note">Press Start listening to enable your browser's audio. Keep this page open while the call runs. A connected silent line may still be ringing or waiting for the other party. This page does not save the call.</p>
  </main>
  <script>
    (() => {
      const sessionId = ${serializedSessionId};
      const button = document.getElementById("listen");
      const status = document.getElementById("status");
      let socket = null;
      let audioContext = null;
      let inputNode = null;
      const nextPlaybackTime = { caller: 0, assistant: 0 };
      const scheduledSources = { caller: new Set(), assistant: new Set() };
      const jitterSeconds = 0.12;
      let ended = false;
      let receivedAudio = false;
      let waitingTimer = null;

      function setStatus(message, isError = false) {
        status.textContent = message;
        status.style.color = isError ? "#ff9d9d" : "#9de6bf";
      }

      function decodeMuLawSample(value) {
        const sample = (~value) & 255;
        const sign = sample & 128;
        const exponent = (sample >> 4) & 7;
        const mantissa = sample & 15;
        let magnitude = ((mantissa << 3) + 132) << exponent;
        magnitude -= 132;
        return Math.max(-1, Math.min(1, (sign ? -magnitude : magnitude) / 32768));
      }

      function play(payload, channel = "assistant") {
        if (!audioContext || !inputNode || !payload) return;
        channel = channel === "caller" ? "caller" : "assistant";
        if ((nextPlaybackTime[channel] || 0) - audioContext.currentTime > 30) {
          clearPlayback(channel);
        }
        const binary = window.atob(payload);
        if (!binary.length) return;
        const buffer = audioContext.createBuffer(1, binary.length, 8000);
        const samples = buffer.getChannelData(0);
        for (let index = 0; index < binary.length; index += 1) {
          const fadeIn = Math.min(1, index / 8);
          const fadeOut = Math.min(1, (binary.length - index - 1) / 8);
          samples[index] =
            decodeMuLawSample(binary.charCodeAt(index)) *
            Math.min(fadeIn, fadeOut);
        }
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(inputNode);
        scheduledSources[channel].add(source);
        source.onended = () => {
          scheduledSources[channel].delete(source);
          source.disconnect();
        };
        const queuedAt = nextPlaybackTime[channel] || 0;
        const startAt = Math.max(
          audioContext.currentTime + jitterSeconds,
          queuedAt,
        );
        source.start(startAt);
        nextPlaybackTime[channel] = startAt + buffer.duration;
      }

      function clearPlayback(channel) {
        for (const source of scheduledSources[channel]) {
          try { source.stop(); source.disconnect(); } catch {}
        }
        scheduledSources[channel].clear();
        nextPlaybackTime[channel] = 0;
      }

      function cleanup() {
        clearTimeout(waitingTimer);
        waitingTimer = null;
        clearPlayback("caller");
        clearPlayback("assistant");
        if (socket) {
          const previous = socket;
          socket = null;
          previous.close();
        }
        if (audioContext && audioContext.state !== "closed") void audioContext.close();
        audioContext = null;
        inputNode = null;
      }

      async function listen() {
        const token = window.location.hash.slice(1);
        if (!token) {
          setStatus("This listening link is incomplete.", true);
          return;
        }
        button.disabled = true;
        button.textContent = "Connecting…";
        try {
          cleanup();
          ended = false;
          receivedAudio = false;
          const AudioContextClass =
            window.AudioContext || window.webkitAudioContext;
          if (!AudioContextClass) throw new Error("Live audio is not supported in this browser.");
          audioContext = new AudioContextClass();
          const highpass = audioContext.createBiquadFilter();
          highpass.type = "highpass";
          highpass.frequency.value = 80;
          const lowpass = audioContext.createBiquadFilter();
          lowpass.type = "lowpass";
          lowpass.frequency.value = 3600;
          const compressor = audioContext.createDynamicsCompressor();
          const gain = audioContext.createGain();
          gain.gain.value = 0.95;
          highpass.connect(lowpass);
          lowpass.connect(compressor);
          compressor.connect(gain);
          gain.connect(audioContext.destination);
          inputNode = highpass;
          await audioContext.resume();

          const url = new URL(window.location.href);
          url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
          url.pathname = "/monitor";
          url.search = "";
          url.hash = "";
          url.searchParams.set("sessionId", sessionId);
          url.searchParams.set("token", token);
          const connection = new WebSocket(url.toString());
          socket = connection;
          waitingTimer = setTimeout(() => {
            if (socket !== connection) return;
            cleanup();
            setStatus("The live audio connection timed out. Reconnect while the call is active.", true);
            button.textContent = "Reconnect audio";
            button.disabled = false;
          }, 15000);
          connection.addEventListener("open", () => {
            if (socket !== connection) return;
            clearTimeout(waitingTimer);
            button.textContent = "Listening live";
            setStatus("Connected. Waiting for call audio…");
            waitingTimer = setTimeout(() => {
              if (!receivedAudio && socket === connection) {
                setStatus("Connected, but no phone audio has arrived yet. The call may still be ringing. If the call is speaking, use Reconnect audio.");
                button.disabled = false;
                button.textContent = "Reconnect audio";
              }
            }, 10000);
          });
          connection.addEventListener("message", (event) => {
            if (socket !== connection) return;
            let message;
            try {
              message = JSON.parse(String(event.data));
            } catch {
              setStatus("Received an invalid live-audio message.", true);
              connection.close();
              return;
            }
            if (message.type === "audio") {
              receivedAudio = true;
              clearTimeout(waitingTimer);
              if (audioContext && audioContext.state !== "running") {
                setStatus("Your browser paused audio. Press Resume audio to continue.", true);
                button.disabled = false;
                button.textContent = "Resume audio";
                return;
              }
              play(message.payload, message.channel || "assistant");
              setStatus("Listening live.");
            } else if (message.type === "clear") {
              clearPlayback("assistant");
            } else if (message.type === "ended") {
              ended = true;
              setStatus("The call has ended.");
              button.textContent = "Call ended";
              cleanup();
            } else if (message.type === "error") {
              setStatus(message.error || "Live audio is unavailable.", true);
              connection.close();
            }
          });
          connection.addEventListener("error", () => {
            if (socket !== connection) return;
            setStatus("Unable to connect to live audio.", true);
          });
          connection.addEventListener("close", () => {
            if (socket !== connection || ended) return;
            cleanup();
            setStatus("Live audio disconnected. Reconnect while the call is active.", true);
            button.textContent = "Reconnect audio";
            button.disabled = false;
          });
        } catch (error) {
          cleanup();
          setStatus(error && error.message ? error.message : "Unable to start live audio.", true);
          button.disabled = false;
          button.textContent = "Try again";
        }
      }

      button.addEventListener("click", () => void listen());
      window.addEventListener("pagehide", cleanup);
    })();
  </script>
</body>
</html>`;
}

