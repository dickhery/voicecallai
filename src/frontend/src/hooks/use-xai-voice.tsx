/**
 * useXaiVoice controls the server-side telephony bridge.
 *
 * Browser responsibilities:
 * 1. Create/update the IC call-history record via paid reservation.
 * 2. Ask the voice server to place / end the Twilio call.
 * 3. Poll session status for queue, remaining paid time, and live transcript.
 * 4. Reattach to an in-progress session after refresh (sessionStorage).
 */

import { CallStatus } from "@/bindings/backend";
import { useReserveCall, useUpdateCallStatus } from "@/hooks/use-backend";
import { getCallFailureMessage, getCallSessionPhase } from "@/lib/call-session";
import {
  EMERGENCY_BLOCKED_MESSAGE,
  isEmergencyDestination,
} from "@/lib/emergency-numbers";
import { rememberRecentPhone } from "@/lib/phone";
import {
  endVoiceServerCall,
  getLiveAudioMonitorUrl,
  getVoiceServerCallSession,
  startVoiceServerCall,
  steerVoiceServerCall,
} from "@/lib/voice-server";
import type {
  CallCaptureOptions,
  VoiceServerCall,
  VoiceServerMediaDiagnostics,
  VoiceServerTranscriptEntry,
} from "@/lib/voice-server";
import { useCallStore } from "@/stores/call-store";
import type { CallPreset } from "@/types";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type XaiCallStatus =
  | "idle"
  | "initiating"
  | "queued"
  | "connecting"
  | "in_call"
  | "completed"
  | "error";

export interface LiveTranscriptLine {
  speaker: string;
  text: string;
}

export interface XaiVoiceState {
  status: XaiCallStatus;
  recipient: string;
  presetName: string;
  durationSecs: number;
  remainingSeconds: number | null;
  allowedSeconds: number | null;
  queuePosition: number | null;
  isMuted: boolean;
  errorMessage: string | null;
  audioLevels: number[];
  liveAudioAvailable: boolean;
  isListeningLive: boolean;
  liveAudioError: string | null;
  liveAudioState: "off" | "connecting" | "waiting" | "receiving";
  callId: string | null;
  mediaDiagnostics: VoiceServerMediaDiagnostics | null;
  isSendingSteeringPrompt: boolean;
  steeringError: string | null;
  liveTranscript: LiveTranscriptLine[];
  isReattaching: boolean;
}

export interface XaiVoiceControls {
  startCall: (
    preset: CallPreset,
    recipient: string,
    captureOptions?: CallCaptureOptions,
  ) => Promise<void>;
  endCall: () => void;
  toggleMute: () => void;
  toggleLiveAudio: () => Promise<void>;
  stopLiveAudio: () => void;
  steerConversation: (prompt: string) => Promise<void>;
  dismissStatus: () => void;
}

const WAVEFORM_BARS = 20;
const MONITOR_SAMPLE_RATE = 8000;
const MONITOR_JITTER_SECONDS = 0.12;
const MONITOR_FADE_SAMPLES = 8;
const CALL_SESSION_POLL_MS = 2000;
const LOW_TIME_WARN_SECONDS = 60;
const TERMINAL_SERVER_STATUSES = new Set([
  "completed",
  "failed",
  "busy",
  "no-answer",
  "canceled",
  "cancelled",
]);

type MonitorChannel = "caller" | "assistant";

interface MonitorAudioMessage {
  type: "audio";
  channel?: MonitorChannel;
  payload?: string;
}

function isTerminalVoiceServerStatus(status?: string): boolean {
  return TERMINAL_SERVER_STATUSES.has(String(status || "").toLowerCase());
}

function isMissingSessionError(error: unknown): boolean {
  return (
    error instanceof Error && /call session not found/i.test(error.message)
  );
}

function decodeBase64Payload(payload: string): Uint8Array {
  const binary = window.atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeMuLawSample(value: number): number {
  const sample = ~value & 0xff;
  const sign = sample & 0x80;
  const exponent = (sample >> 4) & 0x07;
  const mantissa = sample & 0x0f;
  let magnitude = ((mantissa << 3) + 0x84) << exponent;
  magnitude -= 0x84;
  const pcm = sign ? -magnitude : magnitude;
  return Math.max(-1, Math.min(1, pcm / 32768));
}

function writeDecodedMuLawSamples(bytes: Uint8Array, samples: Float32Array) {
  let sumSquares = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const decoded = decodeMuLawSample(bytes[i]);
    sumSquares += decoded * decoded;
    const fadeIn = Math.min(1, i / MONITOR_FADE_SAMPLES);
    const fadeOut = Math.min(1, (bytes.length - i - 1) / MONITOR_FADE_SAMPLES);
    samples[i] = decoded * Math.min(fadeIn, fadeOut);
  }
  return Math.sqrt(sumSquares / Math.max(1, bytes.length));
}

function mapTranscript(
  entries?: VoiceServerTranscriptEntry[],
): LiveTranscriptLine[] {
  if (!entries?.length) return [];
  return entries
    .filter((e) => e?.text?.trim())
    .map((e) => ({
      speaker: e.speaker || "unknown",
      text: e.text,
    }));
}

export function useXaiVoice(): XaiVoiceState & XaiVoiceControls {
  const [status, setStatus] = useState<XaiCallStatus>("idle");
  const [recipient, setRecipient] = useState("");
  const [presetName, setPresetName] = useState("");
  const [durationSecs, setDurationSecs] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [allowedSeconds, setAllowedSeconds] = useState<number | null>(null);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [audioLevels, setAudioLevels] = useState<number[]>(
    Array(WAVEFORM_BARS).fill(0),
  );
  const [liveAudioAvailable, setLiveAudioAvailable] = useState(false);
  const [isListeningLive, setIsListeningLive] = useState(false);
  const [liveAudioError, setLiveAudioError] = useState<string | null>(null);
  const [liveAudioState, setLiveAudioState] =
    useState<XaiVoiceState["liveAudioState"]>("off");
  const [callId, setCallId] = useState<string | null>(null);
  const [mediaDiagnostics, setMediaDiagnostics] =
    useState<VoiceServerMediaDiagnostics | null>(null);
  const [isSendingSteeringPrompt, setIsSendingSteeringPrompt] = useState(false);
  const [steeringError, setSteeringError] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<LiveTranscriptLine[]>(
    [],
  );
  const [isReattaching, setIsReattaching] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const activeCallIdRef = useRef<bigint | null>(null);
  const activeCallSidRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const monitorTokenRef = useRef<string | null>(null);
  const allowedSecondsRef = useRef<number | null>(null);
  const billingStartedAtRef = useRef<number | null>(null);
  const lowTimeWarnedRef = useRef(false);
  const reattachAttemptedRef = useRef(false);
  const monitorWsRef = useRef<WebSocket | null>(null);
  const monitorWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const lastMonitorAudioAtRef = useRef(0);
  const monitorSourcesRef = useRef<
    Record<MonitorChannel, Set<AudioBufferSourceNode>>
  >({ caller: new Set(), assistant: new Set() });
  const audioContextRef = useRef<AudioContext | null>(null);
  const monitorInputNodeRef = useRef<AudioNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const nextPlaybackTimeRef = useRef<Record<MonitorChannel, number>>({
    caller: 0,
    assistant: 0,
  });

  const reserveCall = useReserveCall();
  const updateCallStatus = useUpdateCallStatus();
  const queryClient = useQueryClient();
  const { setActiveCall, clearCall, setSessionMeta, hydrateFromStorage } =
    useCallStore();
  // Keep store remainingSeconds in sync for the sidebar indicator
  const setStoreRemaining = useCallStore((s) => s.setSessionMeta);

  const cleanupTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setAudioLevels(Array(WAVEFORM_BARS).fill(0));
  }, []);

  const cleanupSessionPolling = useCallback(() => {
    if (sessionPollRef.current) {
      clearInterval(sessionPollRef.current);
      sessionPollRef.current = null;
    }
  }, []);

  const stopLiveAudio = useCallback(() => {
    if (monitorWatchdogRef.current) {
      clearInterval(monitorWatchdogRef.current);
      monitorWatchdogRef.current = null;
    }
    for (const sources of Object.values(monitorSourcesRef.current)) {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          /* Already ended. */
        }
      }
      sources.clear();
    }
    const socket = monitorWsRef.current;
    monitorWsRef.current = null;
    socket?.close();
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close();
    }
    audioContextRef.current = null;
    monitorInputNodeRef.current = null;
    gainNodeRef.current = null;
    nextPlaybackTimeRef.current = { caller: 0, assistant: 0 };
    setIsListeningLive(false);
    setLiveAudioState("off");
  }, []);

  const invalidateCallData = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["myCalls"] });
    void queryClient.invalidateQueries({ queryKey: ["myBillingStatus"] });
  }, [queryClient]);

  const playMonitorAudio = useCallback(
    (payload: string, channel: MonitorChannel = "assistant") => {
      const audioContext = audioContextRef.current;
      const monitorInputNode = monitorInputNodeRef.current;
      if (!audioContext || audioContext.state === "closed" || !monitorInputNode)
        return;

      if (audioContext.state !== "running") {
        setLiveAudioError(
          "Your browser paused audio. Stop audio, then click Listen Live again to resume.",
        );
        return;
      }
      const bytes = decodeBase64Payload(payload);
      if (bytes.length === 0) return;

      const buffer = audioContext.createBuffer(
        1,
        bytes.length,
        MONITOR_SAMPLE_RATE,
      );
      const samples = buffer.getChannelData(0);
      const rms = writeDecodedMuLawSamples(bytes, samples);

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(monitorInputNode);
      const activeSources = monitorSourcesRef.current[channel];
      activeSources.add(source);
      source.onended = () => {
        activeSources.delete(source);
        source.disconnect();
      };

      const nextByChannel = nextPlaybackTimeRef.current;
      const queuedAt = nextByChannel[channel] || 0;
      const startAt =
        queuedAt > audioContext.currentTime
          ? queuedAt
          : audioContext.currentTime + MONITOR_JITTER_SECONDS;
      source.start(startAt);
      nextByChannel[channel] = startAt + buffer.duration;

      setAudioLevels((levels) => {
        const peak = Math.min(1, rms * 3.5);
        return [...levels.slice(1), peak];
      });
    },
    [],
  );

  const startLiveAudio = useCallback(async () => {
    const sessionId = activeSessionIdRef.current;
    const monitorToken = monitorTokenRef.current;
    if (!sessionId || !monitorToken) {
      toast.error("Live audio is not available for this call");
      return;
    }
    if (
      monitorWsRef.current &&
      monitorWsRef.current.readyState < WebSocket.CLOSING
    )
      return;
    setLiveAudioState("connecting");
    setLiveAudioError(null);

    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextCtor) {
      setLiveAudioState("off");
      throw new Error("Live audio is not supported in this browser.");
    }

    const audioContext = new AudioContextCtor();
    const highpass = audioContext.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 80;
    highpass.Q.value = 0.7;
    const lowpass = audioContext.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 3600;
    lowpass.Q.value = 0.7;
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.95;
    highpass.connect(lowpass);
    lowpass.connect(compressor);
    compressor.connect(gainNode);
    gainNode.connect(audioContext.destination);
    audioContextRef.current = audioContext;
    monitorInputNodeRef.current = highpass;
    gainNodeRef.current = gainNode;
    nextPlaybackTimeRef.current = {
      caller: audioContext.currentTime + MONITOR_JITTER_SECONDS,
      assistant: audioContext.currentTime + MONITOR_JITTER_SECONDS,
    };
    await audioContext.resume();
    if (audioContext.state !== "running") {
      throw new Error(
        "Audio is paused by your browser. Click Listen Live to enable playback.",
      );
    }

    const monitorUrl = await getLiveAudioMonitorUrl({
      sessionId,
      monitorToken,
    });
    if (
      activeSessionIdRef.current !== sessionId ||
      audioContextRef.current !== audioContext
    )
      return;
    const ws = new WebSocket(monitorUrl);
    monitorWsRef.current = ws;
    monitorWatchdogRef.current = setInterval(() => {
      if (monitorWsRef.current === ws && ws.readyState !== WebSocket.OPEN) {
        stopLiveAudio();
        setLiveAudioError(
          "The live listener timed out. Click Listen Live to retry.",
        );
      }
    }, 10_000);
    setLiveAudioError(null);

    ws.onopen = () => {
      if (monitorWsRef.current !== ws) return;
      setIsListeningLive(true);
      setLiveAudioState("waiting");
      lastMonitorAudioAtRef.current = Date.now();
      if (monitorWatchdogRef.current) clearInterval(monitorWatchdogRef.current);
      monitorWatchdogRef.current = setInterval(() => {
        if (Date.now() - lastMonitorAudioAtRef.current > 12_000) {
          setLiveAudioState("waiting");
          setLiveAudioError(
            "Listener connected, but no audio has arrived recently. The call may be quiet; stop audio and retry if speech is missing.",
          );
        }
      }, 4_000);
    };
    ws.onmessage = (event) => {
      if (monitorWsRef.current !== ws) return;
      try {
        const message = JSON.parse(String(event.data)) as
          | MonitorAudioMessage
          | { type: "clear"; channel?: MonitorChannel }
          | { type: "ended" | "error"; error?: string };
        if (message.type === "audio" && message.payload) {
          lastMonitorAudioAtRef.current = Date.now();
          setLiveAudioState("receiving");
          setLiveAudioError(null);
          playMonitorAudio(message.payload, message.channel || "assistant");
        } else if (message.type === "clear") {
          const channel = message.channel || "assistant";
          for (const source of monitorSourcesRef.current[channel]) {
            try {
              source.stop();
            } catch {
              /* Already ended. */
            }
          }
          monitorSourcesRef.current[channel].clear();
          nextPlaybackTimeRef.current[channel] =
            audioContext.currentTime + MONITOR_JITTER_SECONDS;
        } else if (message.type === "ended") {
          stopLiveAudio();
        } else if (message.type === "error") {
          throw new Error(message.error || "Live audio failed.");
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Live audio failed.";
        setLiveAudioError(message);
      }
    };
    ws.onerror = () => {
      if (monitorWsRef.current !== ws) return;
      setLiveAudioError(
        "Live audio connection failed. Click Listen Live to retry.",
      );
      stopLiveAudio();
    };
    ws.onclose = () => {
      if (monitorWsRef.current !== ws) return;
      stopLiveAudio();
      setLiveAudioError(
        "The live listener disconnected. If the call is active, click Listen Live to reconnect.",
      );
    };
  }, [playMonitorAudio, stopLiveAudio]);

  const startDurationTimer = useCallback(
    (fromMs?: number) => {
      cleanupTimer();
      startTimeRef.current = fromMs || Date.now();
      setDurationSecs(
        Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000)),
      );
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setDurationSecs(elapsed);

        // Client-side remaining estimate between server polls
        if (allowedSecondsRef.current != null && billingStartedAtRef.current) {
          const used = Math.floor(
            (Date.now() - billingStartedAtRef.current) / 1000,
          );
          const left = Math.max(0, allowedSecondsRef.current - used);
          setRemainingSeconds(left);
          setStoreRemaining({ remainingSeconds: left });
          if (
            left > 0 &&
            left <= LOW_TIME_WARN_SECONDS &&
            !lowTimeWarnedRef.current
          ) {
            lowTimeWarnedRef.current = true;
            toast.warning("Less than 1 minute of paid time remaining");
          }
        }
      }, 1000);
    },
    [cleanupTimer, setStoreRemaining],
  );

  const completeLocalCall = useCallback(
    (terminalStatus = "completed", message?: string) => {
      const failed =
        getCallSessionPhase({ status: terminalStatus }) === "error" ||
        Boolean(message);
      setStatus(failed ? "error" : "completed");
      setErrorMessage(
        message || (failed ? getCallFailureMessage(terminalStatus) : null),
      );
      cleanupTimer();
      cleanupSessionPolling();
      stopLiveAudio();
      setLiveAudioAvailable(false);
      setIsSendingSteeringPrompt(false);
      setSteeringError(null);
      setQueuePosition(null);
      setRemainingSeconds(0);
      activeCallIdRef.current = null;
      activeCallSidRef.current = null;
      activeSessionIdRef.current = null;
      monitorTokenRef.current = null;
      clearCall();
      invalidateCallData();
    },
    [
      cleanupTimer,
      cleanupSessionPolling,
      stopLiveAudio,
      clearCall,
      invalidateCallData,
    ],
  );

  const applySessionSnapshot = useCallback(
    (serverCall: VoiceServerCall) => {
      if (serverCall.callSid) {
        activeCallSidRef.current = serverCall.callSid;
      }
      activeSessionIdRef.current = serverCall.sessionId;
      if (serverCall.monitorToken) {
        monitorTokenRef.current = serverCall.monitorToken;
      }
      if (serverCall.allowedSeconds != null) {
        allowedSecondsRef.current = Number(serverCall.allowedSeconds);
        setAllowedSeconds(Number(serverCall.allowedSeconds));
      }
      if (serverCall.remainingSeconds != null) {
        const left = Math.max(0, Number(serverCall.remainingSeconds));
        setRemainingSeconds(left);
        if (
          left > 0 &&
          left <= LOW_TIME_WARN_SECONDS &&
          !lowTimeWarnedRef.current
        ) {
          lowTimeWarnedRef.current = true;
          toast.warning("Less than 1 minute of paid time remaining");
        }
      }
      if (serverCall.billingStartedAt) {
        billingStartedAtRef.current = Number(serverCall.billingStartedAt);
      }
      if (serverCall.recipientPhone) {
        setRecipient(serverCall.recipientPhone);
      }
      if (serverCall.presetName) {
        setPresetName(serverCall.presetName);
      }
      if (serverCall.transcript) {
        setLiveTranscript(mapTranscript(serverCall.transcript));
      }
      if (serverCall.mediaDiagnostics)
        setMediaDiagnostics(serverCall.mediaDiagnostics);
      if (serverCall.queued || !serverCall.callSid) {
        setQueuePosition(
          serverCall.queuePosition != null
            ? Number(serverCall.queuePosition)
            : null,
        );
      } else {
        setQueuePosition(null);
      }

      setSessionMeta({
        sessionId: serverCall.sessionId,
        monitorToken: serverCall.monitorToken || monitorTokenRef.current,
        callSid: serverCall.callSid || activeCallSidRef.current,
        presetName: serverCall.presetName,
        allowedSeconds:
          serverCall.allowedSeconds != null
            ? Number(serverCall.allowedSeconds)
            : undefined,
        remainingSeconds:
          serverCall.remainingSeconds != null
            ? Number(serverCall.remainingSeconds)
            : undefined,
      });
    },
    [setSessionMeta],
  );

  const startSessionPolling = useCallback(
    (sessionId: string, monitorToken: string) => {
      cleanupSessionPolling();

      let polling = false;
      const poll = async () => {
        if (polling || activeSessionIdRef.current !== sessionId) return;
        polling = true;
        try {
          const serverCall = await getVoiceServerCallSession(
            sessionId,
            monitorToken,
          );
          if (activeSessionIdRef.current !== sessionId) return;
          applySessionSnapshot(serverCall);

          if (isTerminalVoiceServerStatus(serverCall.status)) {
            completeLocalCall(serverCall.status);
            return;
          }

          const phase = getCallSessionPhase(serverCall);
          setStatus(phase);
          if (phase === "in_call") {
            setLiveAudioAvailable(
              Boolean(serverCall.monitorToken || monitorToken),
            );
            if (!timerRef.current) {
              startDurationTimer(
                serverCall.billingStartedAt
                  ? Number(serverCall.billingStartedAt)
                  : undefined,
              );
            }
          } else if (phase === "connecting") {
            setLiveAudioAvailable(
              Boolean(serverCall.monitorToken || monitorToken),
            );
          }
        } catch (err) {
          if (
            activeSessionIdRef.current === sessionId &&
            isMissingSessionError(err)
          ) {
            completeLocalCall(
              "failed",
              "The voice server no longer has this session. Its final outcome is unconfirmed; check Call History before retrying.",
            );
          }
        } finally {
          polling = false;
        }
      };

      sessionPollRef.current = setInterval(
        () => void poll(),
        CALL_SESSION_POLL_MS,
      );
      void poll();
    },
    [
      cleanupSessionPolling,
      applySessionSnapshot,
      completeLocalCall,
      startDurationTimer,
    ],
  );

  const markServerCallDispatched = useCallback(
    (serverCall: VoiceServerCall) => {
      applySessionSnapshot(serverCall);
      const phase = getCallSessionPhase(serverCall);
      if (phase === "completed" || phase === "error") {
        completeLocalCall(serverCall.status);
        return;
      }
      setLiveAudioAvailable(Boolean(serverCall.monitorToken));
      setStatus(phase);
      setQueuePosition(null);
      if (phase === "in_call")
        startDurationTimer(serverCall.billingStartedAt || undefined);
      if (serverCall.monitorToken)
        startSessionPolling(serverCall.sessionId, serverCall.monitorToken);
    },
    [
      applySessionSnapshot,
      completeLocalCall,
      startDurationTimer,
      startSessionPolling,
    ],
  );

  const dismissStatus = useCallback(() => {
    setStatus("idle");
    setErrorMessage(null);
    setDurationSecs(0);
    setLiveTranscript([]);
    setCallId(null);
    setMediaDiagnostics(null);
    setLiveAudioError(null);
    setRemainingSeconds(null);
    setAllowedSeconds(null);
    setQueuePosition(null);
  }, []);

  const startCall = useCallback(
    async (
      preset: CallPreset,
      recipientPhone: string,
      captureOptions?: CallCaptureOptions,
    ) => {
      stopLiveAudio();
      cleanupSessionPolling();
      setStatus("initiating");
      setCallId(null);
      setMediaDiagnostics(null);
      setIsMuted(false);
      setDurationSecs(0);
      setRecipient(recipientPhone);
      setPresetName(preset.name);
      setErrorMessage(null);
      setLiveAudioAvailable(false);
      setLiveAudioError(null);
      setSteeringError(null);
      setLiveTranscript([]);
      setQueuePosition(null);
      setRemainingSeconds(null);
      lowTimeWarnedRef.current = false;
      activeCallIdRef.current = null;
      activeCallSidRef.current = null;
      activeSessionIdRef.current = null;
      monitorTokenRef.current = null;
      billingStartedAtRef.current = null;
      allowedSecondsRef.current = null;

      try {
        if (isEmergencyDestination(recipientPhone)) {
          throw new Error(EMERGENCY_BLOCKED_MESSAGE);
        }
        const reservationResult = await reserveCall.mutateAsync({
          recipientPhone,
          presetId: preset.id,
        });
        if (reservationResult.__kind__ === "err") {
          throw new Error(reservationResult.err);
        }

        const {
          callId,
          id: reservationId,
          callToken,
          allowedSeconds: reservedSeconds,
        } = reservationResult.ok;
        if (!callToken) {
          throw new Error("Reservation token was not returned by the backend.");
        }
        activeCallIdRef.current = callId;
        setCallId(callId.toString());
        allowedSecondsRef.current = Number(reservedSeconds);
        setAllowedSeconds(Number(reservedSeconds));
        setRemainingSeconds(Number(reservedSeconds));
        setActiveCall(callId, recipientPhone, preset.id);
        setSessionMeta({
          presetName: preset.name,
          allowedSeconds: Number(reservedSeconds),
          remainingSeconds: Number(reservedSeconds),
        });
        rememberRecentPhone(recipientPhone);

        setStatus("connecting");
        const serverCall = await startVoiceServerCall({
          recipientPhone,
          preset,
          callId,
          reservationId,
          callToken,
          captureOptions,
        });

        activeSessionIdRef.current = serverCall.sessionId;
        monitorTokenRef.current = serverCall.monitorToken || null;
        applySessionSnapshot(serverCall);

        if (serverCall.queued || !serverCall.callSid) {
          setStatus("queued");
          if (!serverCall.monitorToken) {
            throw new Error(
              "Queued call token was not returned by the voice server.",
            );
          }
          startSessionPolling(serverCall.sessionId, serverCall.monitorToken);
          toast.info("All lines are busy. Your call is queued.", {
            description: serverCall.queuePosition
              ? `Queue position ${serverCall.queuePosition}`
              : undefined,
          });
          return;
        }

        markServerCallDispatched(serverCall);
        toast.success("Call placed", {
          description: `Initial ${Math.floor(Number(reservedSeconds) / 60)} paid minutes reserved`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setStatus("error");
        setErrorMessage(message);
        toast.error(`Call failed: ${message}`);

        if (activeCallIdRef.current !== null) {
          updateCallStatus.mutate({
            callId: activeCallIdRef.current,
            status: CallStatus.failed,
            transcript: null,
          });
        }

        cleanupTimer();
        cleanupSessionPolling();
        stopLiveAudio();
        setLiveAudioAvailable(false);
        setSteeringError(null);
        clearCall();
      }
    },
    [
      reserveCall,
      setActiveCall,
      setSessionMeta,
      applySessionSnapshot,
      markServerCallDispatched,
      startSessionPolling,
      updateCallStatus,
      cleanupTimer,
      cleanupSessionPolling,
      stopLiveAudio,
      clearCall,
    ],
  );

  const endCall = useCallback(() => {
    const callSid = activeCallSidRef.current;
    const sessionId = activeSessionIdRef.current;
    const monitorToken = monitorTokenRef.current;

    if (!callSid && !sessionId) {
      completeLocalCall();
      return;
    }

    endVoiceServerCall({ callSid, sessionId, monitorToken })
      .then(() => {
        completeLocalCall();
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast.error(`Unable to end Twilio call: ${message}`);
      });
  }, [completeLocalCall]);

  const toggleMute = useCallback(() => {
    setIsMuted((value) => !value);
    toast.info(
      "Live phone mute is controlled on the handset. Use End Call to stop the AI session.",
    );
  }, []);

  const toggleLiveAudio = useCallback(async () => {
    if (isListeningLive) {
      stopLiveAudio();
      toast.info("Live audio off");
      return;
    }
    try {
      await startLiveAudio();
    } catch (error) {
      stopLiveAudio();
      const message =
        error instanceof Error
          ? error.message
          : "Unable to start live audio. Click Listen Live to retry.";
      setLiveAudioError(message);
      toast.error(message);
    }
  }, [isListeningLive, startLiveAudio, stopLiveAudio]);

  const steerConversation = useCallback(
    async (prompt: string) => {
      const cleanPrompt = prompt.trim();
      const sessionId = activeSessionIdRef.current;
      const monitorToken = monitorTokenRef.current;

      if (!cleanPrompt) {
        setSteeringError("Enter live guidance before sending.");
        return;
      }
      if (status !== "in_call" || !sessionId || !monitorToken) {
        setSteeringError(
          "Live guidance is available once the call is connected.",
        );
        return;
      }

      setIsSendingSteeringPrompt(true);
      setSteeringError(null);
      try {
        await steerVoiceServerCall({
          sessionId,
          monitorToken,
          prompt: cleanPrompt,
        });
        toast.success("Live guidance sent");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unable to send live guidance.";
        setSteeringError(message);
        toast.error(message);
        throw err;
      } finally {
        setIsSendingSteeringPrompt(false);
      }
    },
    [status],
  );

  // Reattach to an active session after page refresh
  useEffect(() => {
    if (reattachAttemptedRef.current) return;
    reattachAttemptedRef.current = true;

    const persisted = hydrateFromStorage();
    if (!persisted) return;

    let cancelled = false;
    setIsReattaching(true);

    void (async () => {
      try {
        const serverCall = await getVoiceServerCallSession(
          persisted.sessionId,
          persisted.monitorToken,
        );
        if (cancelled) return;

        if (isTerminalVoiceServerStatus(serverCall.status)) {
          clearCall();
          setIsReattaching(false);
          return;
        }

        activeCallIdRef.current = BigInt(persisted.callId);
        setCallId(persisted.callId);
        activeSessionIdRef.current = persisted.sessionId;
        monitorTokenRef.current = persisted.monitorToken;
        setRecipient(persisted.recipient || serverCall.recipientPhone || "");
        setPresetName(persisted.presetName || serverCall.presetName || "");
        setActiveCall(
          BigInt(persisted.callId),
          persisted.recipient || serverCall.recipientPhone || "",
          persisted.presetId ? BigInt(persisted.presetId) : 0n,
        );
        applySessionSnapshot({
          ...serverCall,
          sessionId: persisted.sessionId,
          monitorToken: persisted.monitorToken,
        });

        const phase = getCallSessionPhase(serverCall);
        setStatus(phase);
        setLiveAudioAvailable(Boolean(serverCall.callSid));
        if (phase === "in_call") {
          startDurationTimer(
            serverCall.billingStartedAt
              ? Number(serverCall.billingStartedAt)
              : persisted.startedAt,
          );
        }
        startSessionPolling(persisted.sessionId, persisted.monitorToken);
        toast.info("Reconnected to active call");
      } catch {
        if (!cancelled) {
          clearCall();
        }
      } finally {
        if (!cancelled) setIsReattaching(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    hydrateFromStorage,
    clearCall,
    setActiveCall,
    applySessionSnapshot,
    startDurationTimer,
    startSessionPolling,
  ]);

  useEffect(() => {
    return () => {
      cleanupTimer();
      cleanupSessionPolling();
      stopLiveAudio();
    };
  }, [cleanupTimer, cleanupSessionPolling, stopLiveAudio]);

  return {
    status,
    recipient,
    presetName,
    durationSecs,
    remainingSeconds,
    allowedSeconds,
    queuePosition,
    isMuted,
    errorMessage,
    audioLevels,
    liveAudioAvailable,
    isListeningLive,
    liveAudioError,
    liveAudioState,
    callId,
    mediaDiagnostics,
    isSendingSteeringPrompt,
    steeringError,
    liveTranscript,
    isReattaching,
    startCall,
    endCall,
    toggleMute,
    toggleLiveAudio,
    stopLiveAudio,
    steerConversation,
    dismissStatus,
  };
}
