import type {
  AgentCallBatch,
  AgentCallBatchInput,
  AgentCallBatchPreview,
  AgentCallJob,
  CallPreset,
  CallRecordPublic,
} from "@/bindings/backend";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCallBatches } from "@/hooks/use-call-batches";
import { useInternetIdentity } from "@/hooks/use-icp";
import { useTermsStatus } from "@/hooks/use-terms";
import {
  type PendingBatchRequest,
  clearPendingBatch,
  fingerprintBatchIntent,
  getRecoveryStorage,
  readPendingBatch,
  savePendingBatch,
} from "@/lib/batch-recovery";
import { copyTextToClipboard } from "@/lib/clipboard";
import { formatPhoneDisplay } from "@/lib/phone";
import {
  MAX_BATCH_NUMBERS,
  MAX_PHONE_LIST_BYTES,
  parsePhoneList,
} from "@/lib/phone-list";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  ListChecks,
  Loader2,
  PhoneOff,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface BulkCallCardProps {
  presets: CallPreset[];
  selectedPresetId: string;
  onPresetChange: (id: string) => void;
  calls: CallRecordPublic[];
  availableSeconds: number;
  bridgeDown: boolean;
  bridgeSupportsBulk: boolean;
  bridgeHealthLoading: boolean;
}

function targetStatus(
  job: AgentCallJob | undefined,
  call: CallRecordPublic | undefined,
  batch: AgentCallBatch,
): string {
  if (job?.status === "canceled") return "Canceled";
  if (call?.status === "completed") return "Completed";
  if (call?.status === "failed") return "Failed";
  if (call?.status === "inProgress") return "In progress";
  if (!job) return batch.status === "canceled" ? "Canceled" : "Waiting";
  if (job.status === "failed") return "Failed";
  if (job.status === "dispatched") return "Dispatched";
  if (job.status === "claimed") return "Connecting";
  return "Queued";
}

function canEndJob(
  job: AgentCallJob,
  call: CallRecordPublic | undefined,
): boolean {
  return (
    job.status !== "canceled" &&
    job.status !== "failed" &&
    call?.status !== "completed" &&
    call?.status !== "failed"
  );
}

export function BulkCallCard({
  presets,
  selectedPresetId,
  onPresetChange,
  calls,
  availableSeconds,
  bridgeDown,
  bridgeSupportsBulk,
  bridgeHealthLoading,
}: BulkCallCardProps) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [callMinutes, setCallMinutes] = useState("3");
  const [saveTranscript, setSaveTranscript] = useState(false);
  const [recordAudio, setRecordAudio] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [review, setReview] = useState<{
    input: AgentCallBatchInput;
    preview: AgentCallBatchPreview;
    fingerprint: string;
  } | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [preparingReview, setPreparingReview] = useState(false);
  const { identity } = useInternetIdentity();
  const principal = identity?.getPrincipal().toText() ?? "";
  const [pendingRequest, setPendingRequest] =
    useState<PendingBatchRequest | null>(() =>
      readPendingBatch(getRecoveryStorage(), principal),
    );
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const requestKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const terms = useTermsStatus();
  const { batches, preview, enqueue, cancel, endCall } = useCallBatches(open);
  const parsed = useMemo(() => parsePhoneList(source), [source]);
  const selectedPreset = presets.find(
    (preset) => preset.id.toString() === selectedPresetId,
  );
  const callById = useMemo(
    () => new Map(calls.map((call) => [call.id.toString(), call])),
    [calls],
  );
  const minutesPerCall = Number(callMinutes);
  const maxTotalMinutes = parsed.phones.length * minutesPerCall;
  const hasImportError = Boolean(
    fileError || parsed.error || parsed.issues.length,
  );
  const canReview =
    parsed.phones.length > 0 &&
    !hasImportError &&
    Boolean(selectedPreset) &&
    authorized &&
    terms.data?.current === true &&
    Boolean(principal) &&
    (Boolean(pendingRequest) ||
      (availableSeconds >= minutesPerCall * 60 &&
        !bridgeDown &&
        bridgeSupportsBulk));
  const needsRecoveryCheck = Boolean(
    pendingRequest &&
      review &&
      pendingRequest.idempotencyKey === review.input.idempotencyKey &&
      !review.preview.existingBatch &&
      !recoveryChecked,
  );
  const connectorPrompt = `Use VoiceCall AI at ${window.location.origin}. Read its API guide, extract phone numbers from my attached CSV or text list, and validate up to 100 unique E.164 numbers. Use my chosen preset and a ${callMinutes}-minute cap for each call. Preview the batch and show me the exact targets, capture options, and maximum phone time. Ask for my approval before queuing the calls. Show progress and let me cancel remaining calls.`;

  useEffect(() => {
    setPendingRequest(readPendingBatch(getRecoveryStorage(), principal));
    setRecoveryChecked(false);
    requestKey.current = null;
  }, [principal]);

  const checkRecoveryStatus = async () => {
    setOpen(true);
    const result = await batches.refetch();
    if (result.isError) {
      toast.error(
        "Unable to check recent lists. Keep the saved request key and try again.",
      );
      return;
    }
    setRecoveryChecked(true);
    if (
      review &&
      pendingRequest?.idempotencyKey === review.input.idempotencyKey
    ) {
      try {
        const checked = await preview.mutateAsync(review.input);
        if (checked.__kind__ === "ok") {
          setReview({ ...review, preview: checked.ok });
          if (checked.ok.existingBatch) {
            toast.success(
              "The original call list was found. Recover it without creating new calls.",
            );
            return;
          }
        }
      } catch {
        // The lists were refreshed; retain the original key and the uncertain
        // outcome if a separate advisory preview could not be loaded.
      }
    }
    toast.info(
      "Recent lists refreshed. Review them and call history before starting separate work.",
    );
  };

  const startSeparateRequest = () => {
    if (!pendingRequest || !recoveryChecked || enqueue.isPending) return;
    if (
      !clearPendingBatch(
        getRecoveryStorage(),
        principal,
        pendingRequest.idempotencyKey,
      )
    ) {
      toast.error(
        "Unable to clear the saved recovery request in this browser.",
      );
      return;
    }
    setPendingRequest(null);
    setRecoveryChecked(false);
    requestKey.current = null;
    setReview(null);
    setSubmitError("");
    setAuthorized(false);
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setFileError("");
    if (file.size > MAX_PHONE_LIST_BYTES) {
      setFileError("Choose a CSV or text file smaller than 64 KB.");
      return;
    }
    if (!/\.(csv|txt|tsv)$/i.test(file.name)) {
      setFileError(
        "Choose a .csv, .txt, or .tsv file. Export spreadsheets as CSV first.",
      );
      return;
    }
    try {
      const text = await file.text();
      setSource(text);
      setFileName(file.name);
      setAuthorized(false);
    } catch {
      setFileError("Unable to read this file. Try pasting the numbers below.");
    }
  };

  const reviewBatch = async () => {
    if (!canReview || !selectedPreset || preparingReview || preview.isPending)
      return;
    setSubmitError("");
    setPreparingReview(true);
    try {
      const fingerprint = await fingerprintBatchIntent(
        JSON.stringify({
          phones: parsed.phones,
          presetId: selectedPreset.id.toString(),
          minutesPerCall,
          saveTranscript,
          recordAudio,
        }),
      );
      const pending =
        readPendingBatch(getRecoveryStorage(), principal) ?? pendingRequest;
      if (pending && pending.fingerprint !== fingerprint) {
        setPendingRequest(pending);
        toast.error(
          "An earlier queue request has an unknown result. Check recent lists and explicitly choose a separate request before changing its intent.",
        );
        return;
      }
      if (pending) {
        requestKey.current = { fingerprint, key: pending.idempotencyKey };
      } else if (requestKey.current?.fingerprint !== fingerprint) {
        requestKey.current = {
          fingerprint,
          key: `web-batch-${crypto.randomUUID()}`,
        };
      }
      const input: AgentCallBatchInput = {
        recipientPhones: parsed.phones,
        presetId: selectedPreset.id,
        maxCallSeconds: BigInt(minutesPerCall * 60),
        captureOptions: {
          saveTranscript,
          recordAudio,
          consentConfirmed: authorized && terms.data?.current === true,
        },
        idempotencyKey: requestKey.current.key,
      };
      const result = await preview.mutateAsync(input);
      if (result.__kind__ === "err") {
        toast.error(result.err.message);
        return;
      }
      setReview({ input, preview: result.ok, fingerprint });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to preview these calls.",
      );
    } finally {
      setPreparingReview(false);
    }
  };

  const enqueueBatch = async () => {
    if (
      !review ||
      enqueue.isPending ||
      needsRecoveryCheck ||
      (!review.preview.existingBatch && (bridgeDown || !bridgeSupportsBulk))
    )
      return;
    setSubmitError("");
    const recovery = {
      idempotencyKey: review.input.idempotencyKey,
      fingerprint: review.fingerprint,
      createdAt: pendingRequest?.createdAt ?? Date.now(),
    };
    // Write before the update so navigation, reloads, and lost responses retain
    // exactly this request's key. No phone numbers are stored in the browser.
    if (!savePendingBatch(getRecoveryStorage(), principal, recovery)) {
      setSubmitError(
        "Your browser could not save this paid request's recovery key. Enable session storage or resolve the earlier saved request before queuing.",
      );
      return;
    }
    setPendingRequest(recovery);
    setRecoveryChecked(false);
    try {
      // Reuse this key after an uncertain network response so retries cannot create a second batch.
      const result = await enqueue.mutateAsync(review.input);
      if (result.__kind__ === "err") {
        if (
          clearPendingBatch(
            getRecoveryStorage(),
            principal,
            recovery.idempotencyKey,
          )
        )
          setPendingRequest(null);
        setSubmitError(result.err.message);
        return;
      }
      toast.success(
        review.preview.existingBatch
          ? "Existing call list recovered"
          : `${result.ok.recipientPhones.length} calls added to your list`,
      );
      if (
        clearPendingBatch(
          getRecoveryStorage(),
          principal,
          recovery.idempotencyKey,
        )
      )
        setPendingRequest(null);
      setReview(null);
      setSource("");
      setFileName("");
      setAuthorized(false);
      requestKey.current = null;
    } catch (error) {
      setSubmitError(
        `The queue result is unknown; calls may already be running. Check recent lists before retrying with this saved key. ${error instanceof Error ? error.message : "The connection failed."}`,
      );
    }
  };

  const cancelBatch = async (id: string) => {
    try {
      const result = await cancel.mutateAsync(id);
      if (result.__kind__ === "err") toast.error(result.err.message);
      else
        toast.success(
          "Remaining numbers canceled. Calls already dispatched can be ended below.",
        );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to cancel this list.",
      );
    }
  };

  const endBatchCall = async (id: string) => {
    try {
      const result = await endCall.mutateAsync(id);
      if (result.__kind__ === "err") toast.error(result.err.message);
      else toast.success("Call cancellation or hang-up requested.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to end this call.",
      );
    }
  };

  return (
    <>
      <Card
        className="bg-card border-primary/25"
        data-ocid="dashboard.bulk_calls.card"
      >
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-primary" />
                Call a list of numbers
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Upload up to {MAX_BATCH_NUMBERS} numbers. Your agent calls each
                one with a time limit and shares the line with other users.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-controls="bulk-call-content"
            >
              {open ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
              {open ? "Collapse" : "Upload or view lists"}
            </Button>
          </div>
        </CardHeader>
        {!bridgeDown && !bridgeHealthLoading && !bridgeSupportsBulk && (
          <p
            className="mx-6 mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-500"
            aria-live="polite"
          >
            The connected voice bridge needs an operator update before bulk
            calling is available. You can import and validate a list now; new
            call lists cannot be queued yet.
          </p>
        )}
        {pendingRequest && !enqueue.isPending && (
          <div
            className="mx-6 mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2 text-xs"
            aria-live="polite"
          >
            <p>
              An earlier queue request may have succeeded. Check recent lists
              and call history before starting separate work. To recover that
              request, reimport the same numbers and choose the original preset,
              time limit, and capture settings.
            </p>
            <p className="break-all font-mono text-[10px]">
              Saved request key: {pendingRequest.idempotencyKey}
            </p>
            <p className="text-muted-foreground">
              Recovery only deduplicates a batch while it is retained. Starting
              a separate request can create additional paid calls.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={batches.isFetching}
                onClick={() => void checkRecoveryStatus()}
              >
                Check recent lists
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!recoveryChecked || batches.isFetching}
                onClick={startSeparateRequest}
              >
                I checked; start a separate request
              </Button>
            </div>
          </div>
        )}
        {open && (
          <CardContent id="bulk-call-content" className="space-y-6">
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="bulk-phone-file"
                    className="flex items-center gap-1.5 text-xs"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    CSV or text file
                  </Label>
                  <Input
                    id="bulk-phone-file"
                    type="file"
                    accept=".csv,.txt,.tsv,text/csv,text/plain,text/tab-separated-values"
                    onChange={(event) => {
                      void importFile(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                    data-ocid="dashboard.bulk_calls.upload"
                  />
                  {fileName && (
                    <p className="text-xs text-muted-foreground">
                      Loaded {fileName}. Review the numbers before queuing.
                    </p>
                  )}
                  {fileError && (
                    <p role="alert" className="text-xs text-destructive">
                      {fileError}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bulk-phone-text" className="text-xs">
                    Or paste phone numbers
                  </Label>
                  <Textarea
                    id="bulk-phone-text"
                    rows={7}
                    value={source}
                    onChange={(event) => {
                      setSource(event.target.value);
                      setFileName("");
                      setFileError("");
                      setAuthorized(false);
                    }}
                    placeholder={"phone\n+14155550123\n+442079460123"}
                    className="font-mono text-xs"
                    data-ocid="dashboard.bulk_calls.numbers_input"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Include + and the country code. Use one number per line, or
                    a CSV with a phone column. Extensions and country guesses
                    are excluded.
                  </p>
                </div>
                {source && (
                  <div
                    className="rounded-lg border border-border bg-muted/20 p-3 space-y-2 text-xs"
                    aria-live="polite"
                    data-ocid="dashboard.bulk_calls.import_preview"
                  >
                    <p className="font-medium">
                      {parsed.phones.length} unique valid numbers ·{" "}
                      {parsed.duplicates} duplicates removed ·{" "}
                      {parsed.issues.length} invalid rows
                    </p>
                    {parsed.error && (
                      <p className="text-destructive">{parsed.error}</p>
                    )}
                    {parsed.issues.length > 0 && (
                      <div className="max-h-36 overflow-auto space-y-1 text-destructive">
                        <p>Fix or remove the invalid rows before continuing.</p>
                        {parsed.issues.slice(0, 20).map((issue, index) => (
                          <p key={`${issue.row}-${index}`}>
                            Row {issue.row}: {issue.value || "(empty)"} —{" "}
                            {issue.reason}
                          </p>
                        ))}
                        {parsed.issues.length > 20 && (
                          <p>
                            And {parsed.issues.length - 20} more invalid rows.
                          </p>
                        )}
                      </div>
                    )}
                    {parsed.phones.length > 0 && (
                      <details>
                        <summary className="cursor-pointer text-primary">
                          Show validated numbers
                        </summary>
                        <div className="max-h-36 overflow-auto pt-2 font-mono">
                          {parsed.phones.map((phone) => (
                            <p key={phone}>{phone}</p>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="bulk-preset" className="text-xs">
                      Call preset
                    </Label>
                    <Select
                      value={selectedPresetId}
                      onValueChange={onPresetChange}
                    >
                      <SelectTrigger id="bulk-preset">
                        <SelectValue placeholder="Create a preset first" />
                      </SelectTrigger>
                      <SelectContent>
                        {presets.map((preset) => (
                          <SelectItem
                            key={preset.id.toString()}
                            value={preset.id.toString()}
                          >
                            {preset.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bulk-call-limit" className="text-xs">
                      Maximum time per call
                    </Label>
                    <Select value={callMinutes} onValueChange={setCallMinutes}>
                      <SelectTrigger id="bulk-call-limit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 5, 10].map((minutes) => (
                          <SelectItem key={minutes} value={String(minutes)}>
                            {minutes} {minutes === 1 ? "minute" : "minutes"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {selectedPreset && (
                  <p className="text-xs text-muted-foreground">
                    Uses the voice and instructions saved in{" "}
                    {selectedPreset.name}. Include your goal, menu preferences,
                    and the message to leave on voicemail in the preset.
                  </p>
                )}
                <div className="rounded-lg border border-border p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="bulk-transcript" className="text-xs">
                      Save transcripts
                    </Label>
                    <Switch
                      id="bulk-transcript"
                      checked={saveTranscript}
                      onCheckedChange={setSaveTranscript}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="bulk-recording" className="text-xs">
                      Record audio
                    </Label>
                    <Switch
                      id="bulk-recording"
                      checked={recordAudio}
                      onCheckedChange={setRecordAudio}
                    />
                  </div>
                </div>
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1.5 text-xs">
                  <p className="font-medium">
                    Up to {maxTotalMinutes} minutes across{" "}
                    {parsed.phones.length} calls
                  </p>
                  <p className="text-muted-foreground">
                    {Math.floor(availableSeconds / 60)} minutes available. Phone
                    time is reserved for one call when it is dispatched, up to{" "}
                    {callMinutes} minutes. Calls bill in whole minutes; unused
                    reserved minutes are released after settlement.
                  </p>
                  <p className="text-muted-foreground">
                    The list pauses when there is not enough available time for
                    the next call. Add phone time to continue. Uploading a list
                    does not reserve the whole total.
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="bulk-call-authorized"
                    checked={authorized}
                    onCheckedChange={(value) => setAuthorized(value === true)}
                  />
                  <Label
                    htmlFor="bulk-call-authorized"
                    className="text-xs leading-relaxed"
                  >
                    I am authorized to call these numbers. I will follow the
                    calling and consent rules in the accepted terms
                    {saveTranscript || recordAudio
                      ? ", including permission required to save these call artifacts"
                      : ""}
                    .
                  </Label>
                </div>
                <Button
                  type="button"
                  className="w-full gap-2"
                  onClick={() => void reviewBatch()}
                  disabled={!canReview || preview.isPending || preparingReview}
                  data-ocid="dashboard.bulk_calls.review_button"
                >
                  {(preview.isPending || preparingReview) && (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  {pendingRequest
                    ? "Review saved request"
                    : bridgeHealthLoading
                      ? "Checking voice bridge…"
                      : !bridgeDown && !bridgeSupportsBulk
                        ? "Voice bridge update required"
                        : `Review ${parsed.phones.length || ""} calls`}
                </Button>
                {availableSeconds < minutesPerCall * 60 && (
                  <p className="text-xs text-muted-foreground">
                    Add enough phone time for the {callMinutes}-minute per-call
                    limit, or choose a shorter limit.
                  </p>
                )}
                {bridgeDown && (
                  <p className="text-xs text-muted-foreground">
                    The voice bridge must be available before you can queue new
                    calls.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border p-3 text-xs space-y-2">
              <p className="font-medium">
                Using ChatGPT with the Internet Computer connector?
              </p>
              <p className="text-muted-foreground">
                Attach your CSV or text list in the AI chat, or paste the
                numbers there. Ask the connector to extract and preview the
                list, then approve queuing. The same preset, phone-time balance,
                list limits, and fair queue apply. Lists created in chat appear
                below.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={async () => {
                  try {
                    if (await copyTextToClipboard(connectorPrompt)) {
                      toast.success("Call-list request copied");
                    } else {
                      toast.error("Unable to copy the request");
                    }
                  } catch {
                    toast.error("Unable to copy the request");
                  }
                }}
              >
                <Copy className="w-3.5 h-3.5" />
                Copy request for AI chat
              </Button>
            </div>

            <div className="border-t border-border pt-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">Recent call lists</p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-xs"
                  onClick={() => void batches.refetch()}
                  disabled={batches.isFetching}
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${batches.isFetching ? "animate-spin" : ""}`}
                  />
                  Refresh
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Lists rotate between accounts after each dispatched call. Up to
                200 undialed numbers may wait per account, and undialed numbers
                expire after 24 hours. Canceling a list stops numbers still
                waiting; dispatched calls can be ended individually.
              </p>
              {batches.isLoading && (
                <p className="text-xs text-muted-foreground">
                  Loading call lists…
                </p>
              )}
              {batches.isError && (
                <p role="alert" className="text-xs text-destructive">
                  Unable to load call lists. Refresh to try again.
                </p>
              )}
              {batches.data?.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No call lists yet.
                </p>
              )}
              {(batches.data ?? []).map((batch) => (
                <details
                  key={batch.id}
                  className="rounded-lg border border-border p-3"
                  data-ocid="dashboard.bulk_calls.batch"
                >
                  <summary className="cursor-pointer text-sm">
                    <span className="font-medium">
                      {presets.find((preset) => preset.id === batch.presetId)
                        ?.name ?? `Preset #${batch.presetId}`}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {batch.recipientPhones.length} numbers ·{" "}
                      {batch.attemptedCount.toString()} dispatched ·{" "}
                      {batch.remainingCount.toString()} waiting
                    </span>
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      {batch.status === "canceled"
                        ? "Canceled"
                        : batch.remainingCount > 0n
                          ? "Queued"
                          : "All dispatched"}
                    </Badge>
                  </summary>
                  <div className="pt-3 space-y-3">
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(
                        Number(batch.createdAt / 1_000_000n),
                      ).toLocaleString()}{" "}
                      · {Number(batch.maxCallSeconds) / 60} min per call ·{" "}
                      {batch.captureOptions.saveTranscript
                        ? "Transcripts on"
                        : "Transcripts off"}{" "}
                      ·{" "}
                      {batch.captureOptions.recordAudio
                        ? "Recording on"
                        : "Recording off"}
                    </p>
                    {batch.lastError && (
                      <p className="text-xs text-amber-500">
                        {batch.lastError}
                      </p>
                    )}
                    {batch.remainingCount > 0n &&
                      batch.status !== "canceled" && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={cancel.isPending}
                          aria-label={`Cancel remaining calls in list ${batch.id}`}
                          onClick={() => void cancelBatch(batch.id)}
                        >
                          Cancel remaining {batch.remainingCount.toString()}{" "}
                          calls
                        </Button>
                      )}
                    <div className="max-h-64 overflow-auto divide-y divide-border">
                      {batch.recipientPhones.map((phone) => {
                        const job = batch.jobs.find(
                          (item) => item.recipientPhone === phone,
                        );
                        const call = job
                          ? callById.get(job.callId.toString())
                          : undefined;
                        return (
                          <div
                            key={phone}
                            className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"
                          >
                            <div>
                              <p className="font-mono">
                                {formatPhoneDisplay(phone)}
                              </p>
                              {job?.error && (
                                <p className="mt-0.5 text-destructive">
                                  {job.error}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[10px]">
                                {targetStatus(job, call, batch)}
                              </Badge>
                              {job && canEndJob(job, call) && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 gap-1 text-xs"
                                  disabled={endCall.isPending}
                                  aria-label={`${job.status === "queued" ? "Cancel queued call to" : "End call to"} ${phone}`}
                                  onClick={() => void endBatchCall(job.id)}
                                >
                                  <PhoneOff className="w-3 h-3" />
                                  {job.status === "queued"
                                    ? "Cancel"
                                    : "End call"}
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-muted-foreground break-all">
                      List ID: {batch.id}. Final transcripts and recordings
                      appear in call history when enabled.
                    </p>
                  </div>
                </details>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      <Dialog
        open={review !== null}
        onOpenChange={(value) => {
          if (!value && !enqueue.isPending) {
            setReview(null);
            setSubmitError("");
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review this call list</DialogTitle>
            <DialogDescription>
              Queuing starts paid calls as the shared phone line becomes
              available.
            </DialogDescription>
          </DialogHeader>
          {review && (
            <div className="space-y-3 text-sm">
              <p>
                <strong>{review.input.recipientPhones.length} calls</strong>{" "}
                using{" "}
                {presets.find((preset) => preset.id === review.input.presetId)
                  ?.name ?? "your selected preset"}
                .
              </p>
              <p>
                Maximum {Number(review.input.maxCallSeconds) / 60} minutes per
                call; up to{" "}
                <strong>
                  {(review.input.recipientPhones.length *
                    Number(review.input.maxCallSeconds)) /
                    60}{" "}
                  minutes total
                </strong>
                . {Math.floor(Number(review.preview.availableSeconds) / 60)}{" "}
                minutes currently available.
              </p>
              <p className="text-xs text-muted-foreground">
                Phone time is reserved one call at a time and billed in whole
                minutes. The list pauses if the next call cannot be funded.
                Undialed numbers expire after 24 hours. Closing this browser
                does not stop queued calls.
              </p>
              <p className="text-xs">
                Transcripts{" "}
                {review.input.captureOptions.saveTranscript ? "on" : "off"} ·
                Audio recording{" "}
                {review.input.captureOptions.recordAudio ? "on" : "off"}
              </p>
              <div className="max-h-40 overflow-auto rounded-md border border-border p-3 font-mono text-xs">
                {review.input.recipientPhones.map((phone) => (
                  <p key={phone}>{phone}</p>
                ))}
              </div>
              {review.preview.existingBatch && (
                <p className="text-xs text-muted-foreground">
                  This request is already queued. Retrying returns the existing
                  list.
                </p>
              )}
              {submitError && (
                <p role="alert" className="text-xs text-destructive">
                  {submitError}
                </p>
              )}
              {pendingRequest &&
                pendingRequest.idempotencyKey === review.input.idempotencyKey &&
                !review.preview.existingBatch &&
                !enqueue.isPending && (
                  <div className="rounded-md border border-amber-500/30 p-3 space-y-2 text-xs">
                    <p>
                      The result of this saved request is not confirmed. Check
                      recent lists and history before retrying. The saved key
                      only prevents duplicates while the original batch is
                      retained.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={batches.isFetching}
                      onClick={() => void checkRecoveryStatus()}
                    >
                      {recoveryChecked
                        ? "Check recent lists again"
                        : "Check recent lists before retrying"}
                    </Button>
                  </div>
                )}
              {!review.preview.existingBatch &&
                (bridgeDown || !bridgeSupportsBulk) && (
                  <p className="text-xs text-amber-500">
                    Bulk calling is unavailable until the connected voice bridge
                    is ready and supports call lists.
                  </p>
                )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={enqueue.isPending}
              onClick={() => {
                setReview(null);
                setSubmitError("");
              }}
            >
              Back
            </Button>
            <Button
              type="button"
              disabled={
                enqueue.isPending ||
                !review ||
                needsRecoveryCheck ||
                (!review.preview.existingBatch &&
                  (bridgeDown || !bridgeSupportsBulk))
              }
              onClick={() => void enqueueBatch()}
              className="gap-2"
              data-ocid="dashboard.bulk_calls.enqueue_button"
            >
              {enqueue.isPending && (
                <Loader2 className="w-4 h-4 animate-spin" />
              )}
              {review?.preview.existingBatch
                ? "Recover existing list"
                : pendingRequest
                  ? "Retry original paid request"
                  : `Queue ${review?.input.recipientPhones.length} paid calls`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
