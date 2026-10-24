import {
  AnsweringPresetStatus,
  AudioFormat,
  SampleRate,
  Voice,
} from "@/bindings/backend";
import { AgentPresetGallery } from "@/components/AgentPresetGallery";
import { AppLayout } from "@/components/AppLayout";
import { NaturalPromptBuilder } from "@/components/NaturalPromptBuilder";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { VoiceIdSelector, getVoiceLabel } from "@/components/VoiceIdSelector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateAnsweringPreset,
  useDeleteAnsweringPreset,
  useGetAnsweringSetupStatus,
  useListMyAnsweringLiveSessions,
  useListMyAnsweringPresets,
  useSetAnsweringPresetEnabled,
  useUpdateAnsweringPreset,
} from "@/hooks/use-backend";
import { ANSWERING_AGENT_PROMPT, ICP_MCP_URL } from "@/lib/agent-access";
import {
  type AgentPresetTemplate,
  agentPresetToAnsweringDraft,
  appendVoiceSessionBlock,
  stripVoiceSessionBlock,
} from "@/lib/agent-presets";
import {
  ANSWERING_STARTERS,
  isValidAnsweringPhoneNumber,
  normalizeAnsweringPhoneNumber,
} from "@/lib/answering-setup";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  TURN_TIMING_PROFILES,
  getTurnTimingProfile,
  getTurnTimingProfileId,
  normalizeTurnDetection,
} from "@/lib/natural-phone";
import {
  endVoiceServerCall,
  getLiveAudioMonitorUrl,
  getVoiceServerUrl,
} from "@/lib/voice-server";
import type { AnsweringPreset, AnsweringPresetInput } from "@/types";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Copy,
  Headphones,
  Loader2,
  Pencil,
  PhoneCall,
  PhoneOff,
  Plus,
  Radio,
  RefreshCw,
  Settings2,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const DEFAULT_TURN_DETECTION =
  TURN_TIMING_PROFILES.find((profile) => profile.id === "balanced")
    ?.turnDetection ?? TURN_TIMING_PROFILES[0].turnDetection;

const DEFAULT_TOOLS = {
  webSearch: false,
  xSearch: false,
  functionCalling: false,
};
const MAX_AI_INSTRUCTIONS_CHARS = 8000;
const defaultTimingText = {
  threshold: `Default: ${DEFAULT_TURN_DETECTION.threshold.toFixed(2)}`,
  silenceDuration: `Default: ${Number(DEFAULT_TURN_DETECTION.silenceDurationMs)}ms`,
  prefixPadding: `Default: ${Number(DEFAULT_TURN_DETECTION.prefixPaddingMs)}ms`,
};

const TURN_DETECTION_HELP =
  "Choose how quickly the AI responds after the caller pauses. Use Patient listener if callers often pause mid-sentence.";

const MONITOR_SAMPLE_RATE = 8000;
const MONITOR_JITTER_SECONDS = 0.12;

function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function parseNumberInputMs(value: string, fallback: bigint): bigint {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return BigInt(Math.max(0, Math.trunc(parsed)));
}

function cloneTurnDetection(
  turnDetection: AnsweringPresetInput["turnDetection"] = DEFAULT_TURN_DETECTION,
): AnsweringPresetInput["turnDetection"] {
  return normalizeTurnDetection(turnDetection);
}

function answeringPresetToInput(preset: AnsweringPreset): AnsweringPresetInput {
  return {
    name: preset.name,
    phoneNumber: preset.phoneNumber,
    systemPrompt: stripVoiceSessionBlock(preset.systemPrompt).cleanPrompt,
    voice: preset.voice,
    voiceId: preset.voiceId ?? "",
    turnDetection: cloneTurnDetection(preset.turnDetection),
    audioFormat: preset.audioFormat,
    sampleRate: preset.sampleRate,
    toolsEnabled: { ...preset.toolsEnabled },
    captureOptions: { ...preset.captureOptions },
    enabled:
      preset.verificationStatus === AnsweringPresetStatus.verified &&
      preset.enabled,
    webhookSecret: preset.webhookSecret,
  };
}

function restoreAnsweringSystemPrompt(
  draftPrompt: string,
  originalPrompt: string,
): string {
  const existing = stripVoiceSessionBlock(originalPrompt).voiceSession;
  if (!existing) return draftPrompt.trim();
  return appendVoiceSessionBlock(draftPrompt, existing);
}

function normalizeAnsweringPresetInput(
  input: AnsweringPresetInput,
): AnsweringPresetInput {
  return {
    ...input,
    name: input.name.trim(),
    phoneNumber: normalizeAnsweringPhoneNumber(input.phoneNumber),
    systemPrompt: input.systemPrompt.trim(),
    audioFormat: AudioFormat.pcmu,
    sampleRate: SampleRate.hz8000,
    toolsEnabled: {
      webSearch: input.toolsEnabled.webSearch,
      xSearch: input.toolsEnabled.xSearch,
      functionCalling: false,
    },
    turnDetection: cloneTurnDetection(input.turnDetection),
    captureOptions: { ...input.captureOptions },
  };
}

function buildDefaultPreset(): AnsweringPresetInput {
  return {
    name: "",
    phoneNumber: "",
    systemPrompt: "",
    voice: Voice.eve,
    voiceId: "",
    turnDetection: cloneTurnDetection(),
    audioFormat: AudioFormat.pcmu,
    sampleRate: SampleRate.hz8000,
    toolsEnabled: { ...DEFAULT_TOOLS },
    captureOptions: {
      saveTranscript: false,
      recordAudio: false,
      consentConfirmed: false,
    },
    enabled: false,
    webhookSecret: generateWebhookSecret(),
  };
}

function formatDate(ns?: bigint): string {
  if (!ns) return "Never";
  return new Date(Number(ns / 1_000_000n)).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMinutes(seconds: bigint | number): string {
  return `${Math.floor(Number(seconds) / 60)} min`;
}

function webhookUrl(
  baseUrl: string,
  preset: Pick<AnsweringPreset, "webhookSecret">,
) {
  return baseUrl ? `${baseUrl}/answering/incoming/${preset.webhookSecret}` : "";
}

async function copySetupText(value: string, label: string) {
  try {
    if (!(await copyTextToClipboard(value))) throw new Error("Copy failed");
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Unable to copy ${label.toLowerCase()}`);
  }
}

function OptionalVoiceSettings({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Collapsible className="rounded-md border border-border">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-start gap-2 whitespace-normal p-3 text-left"
        >
          <Settings2 className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            Optional: voice and conversation timing
          </span>
          <ChevronDown className="h-4 w-4 shrink-0" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t border-border p-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function decodeBase64Payload(payload: string): Uint8Array {
  const binary = window.atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
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

function TurnDetectionFields({
  value,
  onChange,
  dataOcidPrefix,
}: {
  value: AnsweringPresetInput["turnDetection"];
  onChange: (next: AnsweringPresetInput["turnDetection"]) => void;
  dataOcidPrefix: string;
}) {
  const silenceMs = value.silenceDurationMs ?? 500n;
  const prefixMs = value.prefixPaddingMs ?? 200n;
  const timingProfileId = getTurnTimingProfileId({
    ...value,
    serverVad: true,
  });

  function applyTimingProfile(profileId: string) {
    const profile = getTurnTimingProfile(profileId);
    if (!profile) return;
    onChange(cloneTurnDetection(profile.turnDetection));
  }

  function normalizeTimingValues() {
    onChange(normalizeTurnDetection({ ...value, serverVad: true }));
  }

  return (
    <div className="space-y-4 rounded-md border border-border bg-muted/20 p-4">
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
            Conversation Timing
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {TURN_DETECTION_HELP}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Timing Profile
          </Label>
          <Select value={timingProfileId} onValueChange={applyTimingProfile}>
            <SelectTrigger
              className="w-full"
              data-ocid={`${dataOcidPrefix}.profile.select`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TURN_TIMING_PROFILES.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.label}
                </SelectItem>
              ))}
              <SelectItem value="custom" disabled>
                Custom
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-background/60 p-3">
          <div className="space-y-0.5">
            <Label className="text-xs text-foreground">
              Automatic phone turn detection
            </Label>
            <p className="text-[10px] leading-tight text-muted-foreground">
              Required for live phone calls through the xAI realtime bridge.
            </p>
          </div>
          <Switch
            checked
            disabled
            data-ocid={`${dataOcidPrefix}.server_vad.switch`}
            className="shrink-0"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">
            Speech Sensitivity
          </Label>
          <span className="font-mono text-xs tabular-nums text-primary">
            {(value.threshold ?? 0.5).toFixed(2)}
          </span>
        </div>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[value.threshold ?? 0.5]}
          onValueChange={([threshold]) => onChange({ ...value, threshold })}
          data-ocid={`${dataOcidPrefix}.threshold.slider`}
          className="py-1"
        />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Lower values make the AI more sensitive to quieter speech. Raise it if
          background noise keeps the AI from responding.{" "}
          {defaultTimingText.threshold}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Pause Before Reply (ms)
          </Label>
          <Input
            type="number"
            min={0}
            max={5000}
            step={50}
            value={Number(silenceMs)}
            onChange={(event) =>
              onChange({
                ...value,
                silenceDurationMs: parseNumberInputMs(
                  event.target.value,
                  silenceMs,
                ),
              })
            }
            onBlur={normalizeTimingValues}
            data-ocid={`${dataOcidPrefix}.silence_duration.input`}
            className="font-mono text-sm"
          />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            How long the caller should be quiet before the AI starts answering.
            Increase this if it cuts people off; decrease it if it feels slow.{" "}
            {defaultTimingText.silenceDuration}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Speech Start Buffer (ms)
          </Label>
          <Input
            type="number"
            min={0}
            max={2000}
            step={50}
            value={Number(prefixMs)}
            onChange={(event) =>
              onChange({
                ...value,
                prefixPaddingMs: parseNumberInputMs(
                  event.target.value,
                  prefixMs,
                ),
              })
            }
            onBlur={normalizeTimingValues}
            data-ocid={`${dataOcidPrefix}.prefix_padding.input`}
            className="font-mono text-sm"
          />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Keeps a small amount of audio from just before speech starts so
            first words do not get clipped. {defaultTimingText.prefixPadding}
          </p>
        </div>
      </div>
    </div>
  );
}

function EndLiveCallButton({
  sessionId,
  monitorToken,
  callSid,
  onEnded,
}: {
  sessionId: string;
  monitorToken: string;
  callSid?: string;
  onEnded?: () => void;
}) {
  const [ending, setEnding] = useState(false);

  const handleEnd = async () => {
    if (ending) return;
    setEnding(true);
    try {
      await endVoiceServerCall({
        sessionId,
        monitorToken,
        callSid: callSid || null,
      });
      toast.success("Call end requested");
      onEnded?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to end the live call.";
      toast.error(message);
    } finally {
      setEnding(false);
    }
  };

  return (
    <Button
      type="button"
      variant="destructive"
      size="sm"
      className="gap-1.5"
      disabled={ending}
      onClick={() => void handleEnd()}
      data-ocid="answering.live_call.end_button"
    >
      {ending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <PhoneOff className="h-3.5 w-3.5" />
      )}
      End Call
    </Button>
  );
}

type MonitorChannel = "caller" | "assistant";

function LiveAudioButton({
  sessionId,
  monitorToken,
}: {
  sessionId: string;
  monitorToken: string;
}) {
  const [listening, setListening] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [audioState, setAudioState] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputNodeRef = useRef<AudioNode | null>(null);
  const nextPlaybackRef = useRef<Record<MonitorChannel, number>>({
    caller: 0,
    assistant: 0,
  });
  const sourcesRef = useRef<Record<MonitorChannel, Set<AudioBufferSourceNode>>>(
    { caller: new Set(), assistant: new Set() },
  );
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAudioAtRef = useRef(0);

  const stop = () => {
    const socket = wsRef.current;
    wsRef.current = null;
    socket?.close();
    if (watchdogRef.current) clearInterval(watchdogRef.current);
    watchdogRef.current = null;
    if (audioContextRef.current?.state !== "closed")
      void audioContextRef.current?.close();
    audioContextRef.current = null;
    inputNodeRef.current = null;
    nextPlaybackRef.current = { caller: 0, assistant: 0 };
    for (const sources of Object.values(sourcesRef.current)) sources.clear();
    setListening(false);
    setConnecting(false);
    setAudioState("");
  };

  const playPayload = (payload: string, channel: MonitorChannel) => {
    const audioContext = audioContextRef.current;
    const inputNode = inputNodeRef.current;
    if (!audioContext || !inputNode) return;
    if (audioContext.state !== "running") {
      setAudioState(
        "Your browser paused audio. Stop audio, then click Listen Live again.",
      );
      return;
    }
    const bytes = decodeBase64Payload(payload);
    if (!bytes.length) return;
    const buffer = audioContext.createBuffer(
      1,
      bytes.length,
      MONITOR_SAMPLE_RATE,
    );
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < bytes.length; i += 1)
      samples[i] = decodeMuLawSample(bytes[i]);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(inputNode);
    const sources = sourcesRef.current[channel];
    sources.add(source);
    source.onended = () => {
      sources.delete(source);
      source.disconnect();
    };
    const startAt = Math.max(
      nextPlaybackRef.current[channel],
      audioContext.currentTime + MONITOR_JITTER_SECONDS,
    );
    source.start(startAt);
    nextPlaybackRef.current[channel] = startAt + buffer.duration;
  };

  const start = async () => {
    if (
      connecting ||
      (wsRef.current && wsRef.current.readyState < WebSocket.CLOSING)
    )
      return;
    setConnecting(true);
    setAudioState("");
    try {
      const AudioContextCtor =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextCtor)
        throw new Error("Live audio is not supported in this browser.");
      const audioContext = new AudioContextCtor();
      const highpass = audioContext.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 80;
      const lowpass = audioContext.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 3600;
      const gain = audioContext.createGain();
      gain.gain.value = 0.95;
      highpass.connect(lowpass);
      lowpass.connect(gain);
      gain.connect(audioContext.destination);
      audioContextRef.current = audioContext;
      inputNodeRef.current = highpass;
      nextPlaybackRef.current = {
        caller: audioContext.currentTime + MONITOR_JITTER_SECONDS,
        assistant: audioContext.currentTime + MONITOR_JITTER_SECONDS,
      };
      await audioContext.resume();
      if (audioContext.state !== "running")
        throw new Error(
          "Your browser paused audio. Click Listen Live to enable playback.",
        );
      const url = await getLiveAudioMonitorUrl({ sessionId, monitorToken });
      if (audioContextRef.current !== audioContext) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      watchdogRef.current = setInterval(() => {
        if (wsRef.current === ws && ws.readyState !== WebSocket.OPEN) {
          stop();
          setAudioState(
            "The live listener timed out. Click Listen Live to retry.",
          );
        }
      }, 10_000);
      ws.onopen = () => {
        if (wsRef.current !== ws) return;
        setListening(true);
        setConnecting(false);
        setAudioState("Listener connected; waiting for audio.");
        lastAudioAtRef.current = Date.now();
        if (watchdogRef.current) clearInterval(watchdogRef.current);
        watchdogRef.current = setInterval(() => {
          if (Date.now() - lastAudioAtRef.current > 12_000)
            setAudioState(
              "No recent audio. The call may be quiet; stop and retry if speech is missing.",
            );
        }, 4_000);
      };
      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return;
        try {
          const message = JSON.parse(String(event.data));
          const channel: MonitorChannel =
            message.channel === "caller" ? "caller" : "assistant";
          if (message.type === "audio" && message.payload) {
            lastAudioAtRef.current = Date.now();
            setAudioState("Receiving live audio.");
            playPayload(message.payload, channel);
          } else if (message.type === "clear") {
            for (const source of sourcesRef.current[channel]) {
              try {
                source.stop();
              } catch {
                /* Already ended. */
              }
            }
            sourcesRef.current[channel].clear();
            nextPlaybackRef.current[channel] =
              audioContext.currentTime + MONITOR_JITTER_SECONDS;
          } else if (message.type === "ended") stop();
          else if (message.type === "error")
            throw new Error(message.error || "Live audio failed.");
        } catch (error) {
          setAudioState(
            error instanceof Error ? error.message : "Live audio failed.",
          );
        }
      };
      ws.onerror = () => {
        if (wsRef.current !== ws) return;
        stop();
        setAudioState(
          "Live audio connection failed. Click Listen Live to retry.",
        );
      };
      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        stop();
        setAudioState(
          "Listener disconnected. Click Listen Live to reconnect if the call is active.",
        );
      };
    } catch (error) {
      stop();
      const message =
        error instanceof Error ? error.message : "Unable to start live audio.";
      setAudioState(message);
      toast.error(message);
    }
  };

  useEffect(
    () => () => {
      const socket = wsRef.current;
      wsRef.current = null;
      socket?.close();
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      if (audioContextRef.current?.state !== "closed")
        void audioContextRef.current?.close();
      audioContextRef.current = null;
    },
    [],
  );

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant={listening ? "secondary" : "outline"}
        size="sm"
        className="gap-2"
        disabled={connecting}
        onClick={() => (listening ? stop() : void start())}
      >
        {listening ? (
          <VolumeX className="h-4 w-4" />
        ) : (
          <Volume2 className="h-4 w-4" />
        )}
        {connecting
          ? "Connecting audio…"
          : listening
            ? "Stop Audio"
            : "Listen Live"}
      </Button>
      {audioState && (
        <output className="block max-w-xs text-xs text-muted-foreground">
          {audioState}
        </output>
      )}
    </div>
  );
}

function AnsweringPresetCard({
  preset,
  baseUrl,
}: {
  preset: AnsweringPreset;
  baseUrl: string;
}) {
  const setEnabled = useSetAnsweringPresetEnabled();
  const deletePreset = useDeleteAnsweringPreset();
  const updatePreset = useUpdateAnsweringPreset();
  const setupStatus = useGetAnsweringSetupStatus(preset.id);
  const presetsQuery = useListMyAnsweringPresets();
  const [isEditingPreset, setIsEditingPreset] = useState(false);
  const [draftPreset, setDraftPreset] = useState<AnsweringPresetInput>(() =>
    answeringPresetToInput(preset),
  );
  const isVerified =
    preset.verificationStatus === AnsweringPresetStatus.verified;
  const url = setupStatus.data?.webhookUrl || webhookUrl(baseUrl, preset);
  const draftCaptureRequested =
    draftPreset.captureOptions.saveTranscript ||
    draftPreset.captureOptions.recordAudio;
  const canEnableDraft =
    isVerified &&
    normalizeAnsweringPhoneNumber(draftPreset.phoneNumber) ===
      preset.phoneNumber;

  useEffect(() => {
    if (!isEditingPreset) {
      setDraftPreset(answeringPresetToInput(preset));
    }
  }, [isEditingPreset, preset]);

  const openEditor = () => {
    setDraftPreset(answeringPresetToInput(preset));
    setIsEditingPreset(true);
  };

  const toggleEnabled = async (enabled: boolean) => {
    try {
      const result = await setEnabled.mutateAsync({ id: preset.id, enabled });
      if (result.__kind__ === "err") {
        toast.error(result.err);
        return;
      }
      toast.success(
        enabled
          ? "Answering service on — make a test call"
          : "Answering service off",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to change answering status",
      );
    }
  };

  const remove = async () => {
    try {
      const deleted = await deletePreset.mutateAsync(preset.id);
      if (!deleted)
        throw new Error("This answering preset could not be deleted");
      toast.success("Answering preset deleted");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to delete answering preset",
      );
    }
  };

  const refreshSetup = async () => {
    const [statusResult, presetsResult] = await Promise.all([
      setupStatus.refetch(),
      presetsQuery.refetch(),
    ]);
    if (statusResult.isError || presetsResult.isError) {
      toast.error("Unable to refresh setup. Please try again.");
    } else {
      toast.success("Setup status refreshed");
    }
  };

  const savePreset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanInput = normalizeAnsweringPresetInput(draftPreset);
    if (!cleanInput.name) {
      toast.error("Preset name is required");
      return;
    }
    if (!cleanInput.systemPrompt) {
      toast.error("AI answering instructions are required");
      return;
    }
    if (cleanInput.systemPrompt.length > MAX_AI_INSTRUCTIONS_CHARS) {
      toast.error("AI instructions must be 8000 characters or fewer");
      return;
    }
    if (!isValidAnsweringPhoneNumber(cleanInput.phoneNumber)) {
      toast.error(
        "Enter your Twilio number with its country code, for example +15551234567",
      );
      return;
    }
    if (
      cleanInput.captureOptions.saveTranscript ||
      cleanInput.captureOptions.recordAudio
    ) {
      cleanInput.captureOptions.consentConfirmed = true;
    }
    try {
      const result = await updatePreset.mutateAsync({
        id: preset.id,
        input: {
          ...cleanInput,
          enabled:
            isVerified &&
            cleanInput.phoneNumber === preset.phoneNumber &&
            cleanInput.enabled,
          systemPrompt: restoreAnsweringSystemPrompt(
            cleanInput.systemPrompt,
            preset.systemPrompt,
          ),
        },
      });
      if (result.__kind__ === "err") {
        toast.error(result.err);
        return;
      }
      toast.success("Answering preset updated");
      setIsEditingPreset(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to update answering preset",
      );
    }
  };

  return (
    <>
      <Card
        id={`answering-preset-${preset.id}`}
        className="scroll-mt-4 border-border bg-card"
      >
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-lg">{preset.name}</CardTitle>
              <CardDescription className="font-mono">
                {preset.phoneNumber}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={
                  isVerified
                    ? "border-green-500/40 text-green-400"
                    : "border-yellow-500/40 text-yellow-400"
                }
              >
                {isVerified ? "Webhook verified" : "Connect Twilio"}
              </Badge>
              <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1">
                <Switch
                  checked={preset.enabled}
                  disabled={!isVerified || setEnabled.isPending}
                  onCheckedChange={(enabled) => void toggleEnabled(enabled)}
                  aria-label={`Answer incoming calls for ${preset.name}`}
                />
                <span className="text-xs text-muted-foreground">
                  {preset.enabled ? "On" : "Off"}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={openEditor}
                aria-label="Edit answering preset"
                data-ocid={`answering.preset.edit.${preset.id.toString()}`}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => void remove()}
                disabled={deletePreset.isPending}
                aria-label="Delete answering preset"
              >
                {deletePreset.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 rounded-md border border-primary/25 bg-primary/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {setupStatus.data?.readyForCalls
                  ? "App prerequisites complete — test the live line"
                  : "Finish connecting your answering service"}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={setupStatus.isFetching || presetsQuery.isFetching}
                onClick={() => void refreshSetup()}
                className="gap-1.5"
                data-ocid={`answering.preset.refresh_setup.${preset.id}`}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${setupStatus.isFetching ? "animate-spin" : ""}`}
                />
                Refresh setup
              </Button>
            </div>
            {setupStatus.data ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Shared prepaid phone time:{" "}
                  {formatMinutes(setupStatus.data.availablePhoneSeconds)}{" "}
                  available.
                  {setupStatus.data.availablePhoneSeconds < 60n &&
                    " Add phone time before testing the AI."}
                </p>
                {!!setupStatus.data.nextSteps.length && (
                  <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                    {setupStatus.data.nextSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                )}
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {setupStatus.data.note}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {setupStatus.isError
                  ? "Setup status could not be loaded. Refresh setup to try again."
                  : setupStatus.isPending
                    ? "Checking app prerequisites…"
                    : "Setup details are unavailable. Refresh setup to reload your services."}
              </p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <Link
                to="/user/dashboard"
                className="text-primary hover:underline"
              >
                Buy phone time
              </Link>
              <Link
                to="/user/settings"
                className="text-primary hover:underline"
              >
                Agent access and ICP funding
              </Link>
              <Link to="/user/history" className="text-primary hover:underline">
                View call history
              </Link>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-border p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Voice
              </p>
              <p className="mt-1 text-sm font-semibold">
                {getVoiceLabel(preset.voice, preset.voiceId)}
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Capture
              </p>
              <p className="mt-1 text-sm">
                {[
                  preset.captureOptions.saveTranscript ? "Transcript" : "",
                  preset.captureOptions.recordAudio ? "Audio" : "",
                ]
                  .filter(Boolean)
                  .join(" + ") || "No saved transcript or audio"}
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Last Call
              </p>
              <p className="mt-1 text-sm">
                {formatDate(preset.lastIncomingAt)}
              </p>
            </div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">
                AI Instructions
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={openEditor}
                data-ocid={`answering.preset.edit_button.${preset.id.toString()}`}
              >
                <Pencil className="h-3 w-3" />
                Edit
              </Button>
            </div>
            <p className="line-clamp-3 whitespace-pre-line text-sm text-muted-foreground">
              {stripVoiceSessionBlock(preset.systemPrompt).cleanPrompt}
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">
              Twilio Voice Webhook
            </Label>
            <div className="flex gap-2">
              <Input
                value={url || "Voice server URL is not configured"}
                readOnly
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={!url}
                aria-label="Copy private Twilio webhook URL"
                onClick={() => void copySetupText(url, "Webhook URL")}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              You or the app operator must open this supported number in its
              Twilio account → Voice Configuration → “A call comes in” →
              Webhook. Paste this private URL, choose HTTP POST, and save.
            </p>
            {!isVerified && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Call the Twilio number once, then press Refresh setup. While the
                preset is off, this first call may say the line is unavailable;
                it still verifies the webhook. Then turn it on and make a second
                call to hear and test the AI.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
      <Dialog
        open={isEditingPreset}
        onOpenChange={(open) => {
          setIsEditingPreset(open);
          if (!open) setDraftPreset(answeringPresetToInput(preset));
        }}
      >
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
          data-ocid={`answering.preset.edit_dialog.${preset.id.toString()}`}
        >
          <DialogHeader>
            <DialogTitle>Edit Answering Preset</DialogTitle>
            <DialogDescription>
              Update the phone routing, voice, capture, and response timing for
              {` ${preset.name}`}.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={savePreset} noValidate>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`answering-preset-name-${preset.id}`}>
                  Preset Name
                </Label>
                <Input
                  id={`answering-preset-name-${preset.id}`}
                  value={draftPreset.name}
                  onChange={(event) =>
                    setDraftPreset({
                      ...draftPreset,
                      name: event.target.value,
                    })
                  }
                  data-ocid={`answering.preset.name_input.${preset.id.toString()}`}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`answering-preset-phone-${preset.id}`}>
                  Twilio Number
                </Label>
                <Input
                  id={`answering-preset-phone-${preset.id}`}
                  value={draftPreset.phoneNumber}
                  onChange={(event) =>
                    setDraftPreset({
                      ...draftPreset,
                      phoneNumber: event.target.value,
                    })
                  }
                  placeholder="+15551234567"
                  data-ocid={`answering.preset.phone_input.${preset.id.toString()}`}
                  required
                />
                {draftPreset.phoneNumber !== preset.phoneNumber && (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Changing the number will pause this preset until the new
                    Twilio webhook is verified.
                  </p>
                )}
              </div>
            </div>

            <NaturalPromptBuilder
              direction="inbound"
              onPromptChange={(systemPrompt) =>
                setDraftPreset({
                  ...draftPreset,
                  systemPrompt,
                })
              }
              dataOcidPrefix={`answering.preset.${preset.id.toString()}.natural_prompt`}
            />

            <div className="space-y-2">
              <Label htmlFor={`answering-preset-instructions-${preset.id}`}>
                AI Instructions
              </Label>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Type a custom prompt here, or open the builder above to generate
                a starting point and then edit it. Include the exact name or
                role the AI should use, plus the goal, facts, boundaries, and
                expected questions.
              </p>
              <Textarea
                id={`answering-preset-instructions-${preset.id}`}
                value={draftPreset.systemPrompt}
                onChange={(event) =>
                  setDraftPreset({
                    ...draftPreset,
                    systemPrompt: event.target.value,
                  })
                }
                rows={7}
                maxLength={MAX_AI_INSTRUCTIONS_CHARS}
                data-ocid={`answering.preset.instructions_textarea.${preset.id.toString()}`}
                className="resize-none font-mono text-xs leading-relaxed"
                required
              />
              <div className="flex justify-end">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {draftPreset.systemPrompt.trim().length}/
                  {MAX_AI_INSTRUCTIONS_CHARS}
                </span>
              </div>
            </div>

            <OptionalVoiceSettings>
              <div className="space-y-2">
                <Label>Voice</Label>
                <VoiceIdSelector
                  value={{
                    voice: draftPreset.voice,
                    voiceId: draftPreset.voiceId,
                  }}
                  onChange={(next) =>
                    setDraftPreset({
                      ...draftPreset,
                      voice: next.voice,
                      voiceId: next.voiceId ?? "",
                    })
                  }
                  dataOcidPrefix={`answering.preset.${preset.id.toString()}`}
                />
              </div>

              <TurnDetectionFields
                value={draftPreset.turnDetection}
                onChange={(turnDetection) =>
                  setDraftPreset({ ...draftPreset, turnDetection })
                }
                dataOcidPrefix={`answering.preset.${preset.id.toString()}.turn_detection`}
              />
            </OptionalVoiceSettings>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex items-center gap-3 rounded-md border border-border p-3">
                <Checkbox
                  id={`answering-preset-save-transcript-${preset.id}`}
                  checked={draftPreset.captureOptions.saveTranscript}
                  onCheckedChange={(checked) =>
                    setDraftPreset({
                      ...draftPreset,
                      captureOptions: {
                        ...draftPreset.captureOptions,
                        saveTranscript: checked === true,
                      },
                    })
                  }
                />
                <Label
                  htmlFor={`answering-preset-save-transcript-${preset.id}`}
                  className="text-sm"
                >
                  Save transcripts
                </Label>
              </div>
              <div className="flex items-center gap-3 rounded-md border border-border p-3">
                <Checkbox
                  id={`answering-preset-record-audio-${preset.id}`}
                  checked={draftPreset.captureOptions.recordAudio}
                  onCheckedChange={(checked) =>
                    setDraftPreset({
                      ...draftPreset,
                      captureOptions: {
                        ...draftPreset.captureOptions,
                        recordAudio: checked === true,
                      },
                    })
                  }
                />
                <Label
                  htmlFor={`answering-preset-record-audio-${preset.id}`}
                  className="text-sm"
                >
                  Save audio recordings
                </Label>
              </div>
            </div>

            {draftCaptureRequested && (
              <p className="text-sm leading-relaxed text-muted-foreground">
                The terms you accepted explain that some places require every
                person on the call to agree before a recording or transcript is
                saved. You are responsible for that rule.
              </p>
            )}

            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <Label
                htmlFor={`answering-preset-enabled-${preset.id}`}
                className="text-sm"
              >
                Answer incoming calls
              </Label>
              <Switch
                id={`answering-preset-enabled-${preset.id}`}
                checked={canEnableDraft && draftPreset.enabled}
                disabled={!canEnableDraft}
                onCheckedChange={(enabled) =>
                  setDraftPreset({ ...draftPreset, enabled })
                }
              />
            </div>
            {!canEnableDraft && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Verify this number with a call before turning the service on.
                Changing the number keeps the service off until the new webhook
                is verified.
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsEditingPreset(false);
                  setDraftPreset(answeringPresetToInput(preset));
                }}
                data-ocid={`answering.preset.edit_cancel_button.${preset.id.toString()}`}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updatePreset.isPending}
                data-ocid={`answering.preset.edit_save_button.${preset.id.toString()}`}
                className="gap-2"
              >
                {updatePreset.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Pencil className="h-4 w-4" />
                )}
                Update Preset
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AnsweringServicePage() {
  const [baseUrl, setBaseUrl] = useState("");
  const [createdPresetId, setCreatedPresetId] = useState<bigint | null>(null);
  const [input, setInput] = useState<AnsweringPresetInput>(() =>
    buildDefaultPreset(),
  );
  const presets = useListMyAnsweringPresets();
  const queryClient = useQueryClient();
  const liveSessions = useListMyAnsweringLiveSessions(!!presets.data?.length);
  const createPreset = useCreateAnsweringPreset();
  const pendingPreset = presets.data?.find(
    (preset) =>
      preset.verificationStatus === AnsweringPresetStatus.pendingVerification,
  );
  const captureRequested =
    input.captureOptions.saveTranscript || input.captureOptions.recordAudio;

  const refreshServices = async () => {
    const [result] = await Promise.all([
      presets.refetch(),
      queryClient.invalidateQueries({ queryKey: ["answeringSetupStatus"] }),
    ]);
    if (result.isError) toast.error("Unable to refresh answering services");
    else toast.success("Answering services refreshed");
  };

  useEffect(() => {
    getVoiceServerUrl()
      .then(setBaseUrl)
      .catch(() => setBaseUrl(""));
  }, []);

  useEffect(() => {
    if (createdPresetId === null) return;
    if (!presets.data?.some((preset) => preset.id === createdPresetId)) return;
    const createdCard = document.getElementById(
      `answering-preset-${createdPresetId}`,
    );
    if (!createdCard) return;
    createdCard.scrollIntoView({ behavior: "smooth", block: "start" });
    setCreatedPresetId(null);
  }, [createdPresetId, presets.data]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanInput = normalizeAnsweringPresetInput(input);
    if (!cleanInput.name) {
      toast.error("Preset name is required");
      return;
    }
    if (!cleanInput.systemPrompt) {
      toast.error("AI answering instructions are required");
      return;
    }
    if (cleanInput.systemPrompt.length > MAX_AI_INSTRUCTIONS_CHARS) {
      toast.error("AI instructions must be 8000 characters or fewer");
      return;
    }
    if (!isValidAnsweringPhoneNumber(cleanInput.phoneNumber)) {
      toast.error(
        "Enter your Twilio number with its country code, for example +15551234567",
      );
      return;
    }
    if (
      cleanInput.captureOptions.saveTranscript ||
      cleanInput.captureOptions.recordAudio
    ) {
      cleanInput.captureOptions.consentConfirmed = true;
    }
    try {
      const result = await createPreset.mutateAsync({
        ...cleanInput,
        enabled: false,
      });
      if (result.__kind__ === "err") {
        toast.error(result.err);
        return;
      }
      toast.success("Preset saved — connect its webhook in Twilio next");
      setInput(buildDefaultPreset());
      setCreatedPresetId(result.ok.id);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to create answering preset",
      );
    }
  };

  const handleUseAgentTemplate = (template: AgentPresetTemplate) => {
    const draft = agentPresetToAnsweringDraft(template);
    setInput((current) => ({
      ...current,
      name: draft.name,
      systemPrompt: draft.systemPrompt,
      voice: draft.voice,
      voiceId: draft.voiceId,
      turnDetection: draft.turnDetection,
      toolsEnabled: draft.toolsEnabled,
      audioFormat: draft.audioFormat,
      sampleRate: draft.sampleRate,
    }));
    toast.success(`Loaded “${template.name}”`, {
      description:
        "Add your supported Twilio number, then save the answering service.",
    });
    document
      .querySelector('[data-ocid="answering.create_form"]')
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="space-y-6" data-ocid="answering.page">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="font-display text-3xl font-bold tracking-tight">
                AI Answering
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Let an AI greet callers, answer your FAQs, or collect callback
                and appointment requests on a supported Twilio number.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                disabled={presets.isFetching}
                onClick={() => void refreshServices()}
              >
                <RefreshCw
                  className={`h-4 w-4 ${presets.isFetching ? "animate-spin" : ""}`}
                />
                Refresh services
              </Button>
              <Button variant="outline" className="gap-2" asChild>
                <a
                  href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming"
                  target="_blank"
                  rel="noreferrer"
                >
                  <PhoneCall className="h-4 w-4" />
                  Open Twilio
                </a>
              </Button>
            </div>
          </div>

          <Card
            className="border-primary/25 bg-primary/5"
            data-ocid="answering.agent_help.card"
          >
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-2 font-medium">
                <Bot className="h-5 w-5 text-primary" />
                Ask your AI agent to set this up for you
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                In ChatGPT, connect the Internet Computer Protocol plugin, or
                use the ICP MCP connector in a compatible AI client. After you
                sign in with Internet Identity and authorize actions, your agent
                can create and edit the answering service, check setup, and
                retrieve saved call results. You or the app operator connect the
                Twilio webhook, and you configure your carrier’s forwarding; the
                connector does not control Twilio or your carrier. Press Refresh
                services here after your agent makes changes.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="gap-2"
                  onClick={() =>
                    void copySetupText(
                      ANSWERING_AGENT_PROMPT,
                      "Agent setup prompt",
                    )
                  }
                  data-ocid="answering.agent_help.copy_prompt"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy setup prompt
                </Button>
                <Button type="button" variant="outline" size="sm" asChild>
                  <Link to="/user/settings">Connect an agent</Link>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void copySetupText(ICP_MCP_URL, "MCP connector URL")
                  }
                >
                  Copy MCP URL
                </Button>
              </div>
            </CardContent>
          </Card>

          <AgentPresetGallery
            kind="inbound"
            title="Answering agent presets"
            description="Professional receptionists and playful themed greeters. Loads the create form — you still need a supported Twilio number."
            actionLabel="Use this agent"
            onUseTemplate={handleUseAgentTemplate}
            dataOcidPrefix="answering.agent_gallery"
            collapsible
            defaultOpen={false}
          />

          <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Plus className="h-5 w-5 text-primary" />
                  1. Describe your answering service
                </CardTitle>
                <CardDescription>
                  Create one preset per supported Twilio number. Start with a
                  template or write your own instructions; the default voice and
                  timing are ready to use.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {presets.isLoading ? (
                  <Skeleton className="h-36 w-full" />
                ) : presets.isError ? (
                  <div className="space-y-3 rounded-md border border-border p-3 text-sm text-muted-foreground">
                    <p>
                      We could not load your existing services. Reload them
                      before adding another number.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void presets.refetch()}
                      disabled={presets.isFetching}
                    >
                      Retry loading services
                    </Button>
                  </div>
                ) : pendingPreset ? (
                  <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                    Finish connecting {pendingPreset.phoneNumber} before adding
                    another number.
                    <a
                      href={`#answering-preset-${pendingPreset.id}`}
                      className="ml-1 underline"
                    >
                      Open its setup steps and webhook
                    </a>
                    .
                  </div>
                ) : (
                  <form
                    className="space-y-4"
                    onSubmit={submit}
                    noValidate
                    data-ocid="answering.create_form"
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="answering-name">Service name</Label>
                        <Input
                          id="answering-name"
                          value={input.name}
                          onChange={(event) =>
                            setInput({ ...input, name: event.target.value })
                          }
                          placeholder="After-hours support"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="answering-phone">
                          Supported Twilio number
                        </Label>
                        <Input
                          id="answering-phone"
                          type="tel"
                          value={input.phoneNumber}
                          onChange={(event) =>
                            setInput({
                              ...input,
                              phoneNumber: event.target.value,
                            })
                          }
                          placeholder="+15551234567"
                          required
                        />
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          Ask the app operator for a number supported by its
                          voice bridge. Include the country code. Numbers in a
                          separate Twilio account require operator setup.
                          Forwarding uses this Twilio destination.
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">
                        Start with a common task
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {ANSWERING_STARTERS.map((starter) => (
                          <Button
                            key={starter.id}
                            type="button"
                            variant="outline"
                            size="sm"
                            title={starter.description}
                            onClick={() => {
                              if (
                                input.systemPrompt.trim() &&
                                !ANSWERING_STARTERS.some(
                                  (item) =>
                                    item.systemPrompt === input.systemPrompt,
                                )
                              ) {
                                toast.info(
                                  "Clear the instructions first to load a starter, or edit your current instructions.",
                                );
                                return;
                              }
                              setInput({
                                ...input,
                                name: input.name || starter.name,
                                systemPrompt: starter.systemPrompt,
                              });
                            }}
                            data-ocid={`answering.starter.${starter.id}`}
                          >
                            {starter.name}
                          </Button>
                        ))}
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        For after-hours answering, use message taking and add
                        your business hours. Appointment requests need a person
                        to confirm the booking.
                      </p>
                    </div>
                    <NaturalPromptBuilder
                      direction="inbound"
                      onPromptChange={(systemPrompt) => {
                        const existing = stripVoiceSessionBlock(
                          input.systemPrompt,
                        ).voiceSession;
                        setInput({
                          ...input,
                          systemPrompt: existing
                            ? appendVoiceSessionBlock(systemPrompt, existing)
                            : systemPrompt,
                        });
                      }}
                      dataOcidPrefix="answering.natural_prompt"
                    />
                    <div className="space-y-2">
                      <Label htmlFor="answering-instructions">
                        What should the AI say and do?
                      </Label>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Type a custom prompt here, or open the builder above to
                        generate a starting point and then edit it. Include the
                        business name, greeting, facts it may share, what to
                        ask, and what to do when it cannot help. It cannot book
                        appointments, transfer calls, or send messages to your
                        other apps automatically.
                      </p>
                      <Textarea
                        id="answering-instructions"
                        value={
                          stripVoiceSessionBlock(input.systemPrompt).cleanPrompt
                        }
                        onChange={(event) => {
                          const existing = stripVoiceSessionBlock(
                            input.systemPrompt,
                          ).voiceSession;
                          setInput({
                            ...input,
                            systemPrompt: existing
                              ? appendVoiceSessionBlock(
                                  event.target.value,
                                  existing,
                                )
                              : event.target.value,
                          });
                        }}
                        rows={5}
                        maxLength={MAX_AI_INSTRUCTIONS_CHARS}
                        className="resize-none font-mono text-xs"
                        placeholder="You are Jordan Rivera, the front desk assistant for a small design studio. Ask for the caller's name, reason for calling, and preferred callback time."
                        required
                      />
                    </div>
                    <OptionalVoiceSettings>
                      <div className="space-y-2">
                        <Label>Voice</Label>
                        <VoiceIdSelector
                          value={{ voice: input.voice, voiceId: input.voiceId }}
                          onChange={(next) =>
                            setInput({
                              ...input,
                              voice: next.voice,
                              voiceId: next.voiceId ?? "",
                            })
                          }
                          dataOcidPrefix="answering"
                        />
                      </div>
                      <TurnDetectionFields
                        value={input.turnDetection}
                        onChange={(turnDetection) =>
                          setInput({ ...input, turnDetection })
                        }
                        dataOcidPrefix="answering.turn_detection"
                      />
                    </OptionalVoiceSettings>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">
                        Keep a record of calls?
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Choose Save transcripts if you want to read messages and
                        callback details later in Call History. Both options
                        start off.
                      </p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="flex items-center gap-3 rounded-md border border-border p-3">
                        <Checkbox
                          id="answering-save-transcript"
                          checked={input.captureOptions.saveTranscript}
                          onCheckedChange={(checked) =>
                            setInput({
                              ...input,
                              captureOptions: {
                                ...input.captureOptions,
                                saveTranscript: checked === true,
                              },
                            })
                          }
                        />
                        <Label
                          htmlFor="answering-save-transcript"
                          className="text-sm"
                        >
                          Save transcripts
                        </Label>
                      </div>
                      <div className="flex items-center gap-3 rounded-md border border-border p-3">
                        <Checkbox
                          id="answering-record-audio"
                          checked={input.captureOptions.recordAudio}
                          onCheckedChange={(checked) =>
                            setInput({
                              ...input,
                              captureOptions: {
                                ...input.captureOptions,
                                recordAudio: checked === true,
                              },
                            })
                          }
                        />
                        <Label
                          htmlFor="answering-record-audio"
                          className="text-sm"
                        >
                          Save audio recordings
                        </Label>
                      </div>
                    </div>
                    {captureRequested && (
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        The terms you accepted explain that some places require
                        every person on the call to agree before a recording or
                        transcript is saved. You are responsible for that rule.
                      </p>
                    )}
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Your new service starts off. Connect and verify Twilio,
                      then turn it on when you are ready. Creating a preset does
                      not buy phone time.
                    </p>
                    <Button
                      type="submit"
                      className="w-full gap-2"
                      disabled={createPreset.isPending}
                    >
                      {createPreset.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      Save and connect Twilio
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  2. Connect · 3. Test and turn on
                </CardTitle>
                <CardDescription>
                  Your agent can prepare the preset. These final steps connect
                  real calls.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <ol className="list-decimal space-y-3 pl-4 leading-relaxed">
                  <li>
                    Ask the app operator for a supported voice-capable Twilio
                    number, then save your answering service here with that
                    exact number. The bridge uses its configured Twilio account;
                    a number in a separate account will need operator setup.
                    Saving a preset does not buy or provision a number.
                  </li>
                  <li>
                    Open the saved preset below and copy its private webhook
                    URL. You or the operator with access to the configured
                    Twilio account must open the number → Voice Configuration →
                    “A call comes in”, select Webhook, paste the URL, select
                    HTTP POST, and save.
                  </li>
                  <li>
                    Call the Twilio number once and press Refresh setup on your
                    preset. The first call verifies routing. A service that is
                    off may say it is unavailable during this verification call.
                  </li>
                  <li>
                    Add prepaid phone time on the{" "}
                    <Link
                      to="/user/dashboard"
                      className="text-primary hover:underline"
                    >
                      Dashboard
                    </Link>
                    , or ask your connected agent to show ICP phone-time
                    packages. Incoming and outgoing calls share the same
                    balance. Your Twilio number and carrier charges are billed
                    separately by those providers.
                  </li>
                  <li>
                    Turn your verified service on, then make another test call
                    to hear the AI. Check its greeting, answers, and any saved
                    transcript in
                    <Link
                      to="/user/history"
                      className="ml-1 text-primary hover:underline"
                    >
                      Call History
                    </Link>
                    . A verified webhook alone does not confirm the AI
                    conversation works.
                  </li>
                </ol>
                <details className="rounded-md border border-border p-3">
                  <summary className="cursor-pointer font-medium text-foreground">
                    Use your existing business or mobile number
                  </summary>
                  <p className="mt-2 text-xs leading-relaxed">
                    Configure call forwarding with your carrier or phone
                    provider to send calls to the Twilio number. Choose
                    unanswered, busy, or all calls if your provider supports it.
                    Keep the Twilio destination in the preset. Test by calling
                    your original number from another phone. Forwarding rules,
                    schedules, and charges are controlled by your provider; the
                    app does not switch forwarding on for you.
                  </p>
                </details>
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  The operator configures Twilio credentials on the voice
                  bridge; do not paste Auth Tokens into chat or preset
                  instructions. Keep the webhook URL private. Turning a preset
                  off rejects new calls before the AI answers; it does not
                  restore your carrier’s voicemail.
                </div>
                <a
                  href="https://www.twilio.com/docs/voice/twiml/stream"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex text-primary hover:underline"
                >
                  Twilio Media Streams documentation
                </a>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Radio className="h-5 w-5 text-primary" />
                Live Incoming Calls
              </CardTitle>
              <CardDescription>
                Active calls appear here while Twilio is connected. Listen in or
                end a call; saved transcripts and audio appear in Call History
                when enabled.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {liveSessions.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : liveSessions.isError ? (
                <div className="space-y-2 rounded-md border border-border p-4 text-sm text-muted-foreground">
                  <p>Live calls could not be loaded.</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void liveSessions.refetch()}
                    disabled={liveSessions.isFetching}
                  >
                    Retry live calls
                  </Button>
                </div>
              ) : liveSessions.data?.length ? (
                <div className="space-y-3">
                  {liveSessions.data.map((session) => (
                    <div
                      key={session.sessionId}
                      className="flex flex-col gap-3 rounded-md border border-border p-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <p className="font-medium">
                          {session.answeringPresetName}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {session.callerPhone} ·{" "}
                          {formatMinutes(session.allowedSeconds)} reserved
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <LiveAudioButton
                          sessionId={session.sessionId}
                          monitorToken={session.monitorToken}
                        />
                        <EndLiveCallButton
                          sessionId={session.sessionId}
                          monitorToken={session.monitorToken}
                          callSid={session.callSid}
                          onEnded={() => void liveSessions.refetch()}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-md border border-border p-4 text-sm text-muted-foreground">
                  <Headphones className="h-4 w-4" />
                  No live incoming calls.
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Answering Presets</h2>
              <Badge variant="outline">
                {presets.data?.length ?? 0} configured
              </Badge>
            </div>
            {presets.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-36 w-full" />
                <Skeleton className="h-36 w-full" />
              </div>
            ) : presets.isError ? (
              <Card>
                <CardContent className="space-y-3 p-6 text-sm text-muted-foreground">
                  <p>Your answering services could not be loaded.</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void presets.refetch()}
                    disabled={presets.isFetching}
                  >
                    Retry loading services
                  </Button>
                </CardContent>
              </Card>
            ) : presets.data?.length ? (
              <div className="space-y-3">
                {presets.data.map((preset) => (
                  <AnsweringPresetCard
                    key={preset.id.toString()}
                    preset={preset}
                    baseUrl={baseUrl}
                  />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
                  <PhoneOff className="h-4 w-4" />
                  No answering presets yet.
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
