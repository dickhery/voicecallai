import type { backendInterface } from "../bindings/backend";
import {
  AnsweringPresetStatus,
  AudioFormat,
  CallStatus,
  CallReservationStatus,
  PurchaseIntentStatus,
  SampleRate,
  StripeMode,
  UserRole,
  Variant_info_warn_error,
  Voice,
} from "../bindings/backend";
import type { Principal } from "@icp-sdk/core/principal";

const samplePrincipal = {
  toText: () => "aaaaa-aa",
  toString: () => "aaaaa-aa",
  isAnonymous: () => false,
} as unknown as Principal;

const samplePreset = {
  id: BigInt(1),
  name: "Professional Sales Call",
  ownerId: samplePrincipal,
  voice: Voice.eve,
  voiceId: "",
  systemPrompt:
    "You are a professional sales assistant. Greet the customer warmly, ask how you can assist them with their recent order, and guide them to relevant support articles if needed.",
  sampleRate: SampleRate.hz8000,
  audioFormat: AudioFormat.pcmu,
  toolsEnabled: {
    xSearch: false,
    webSearch: false,
    functionCalling: false,
  },
  turnDetection: {
    prefixPaddingMs: BigInt(300),
    threshold: 0.5,
    silenceDurationMs: BigInt(800),
    serverVad: true,
  },
};

const samplePreset2 = {
  id: BigInt(2),
  name: "Customer Support",
  ownerId: samplePrincipal,
  voice: Voice.ara,
  voiceId: "",
  systemPrompt:
    "You are a helpful customer support agent. Listen carefully and resolve issues efficiently.",
  sampleRate: SampleRate.hz8000,
  audioFormat: AudioFormat.pcmu,
  toolsEnabled: {
    xSearch: false,
    webSearch: false,
    functionCalling: false,
  },
  turnDetection: {
    prefixPaddingMs: BigInt(200),
    threshold: 0.6,
    silenceDurationMs: BigInt(600),
    serverVad: true,
  },
};

const sampleCallRecord = {
  id: BigInt(1),
  startTime: BigInt(Date.now() - 3600000),
  endTime: BigInt(Date.now() - 3600000 + 222000),
  status: CallStatus.completed,
  userId: samplePrincipal,
  recipientPhone: "+1 (555) 234-5678",
  callSid: "CA1234567890abcdef",
  presetId: BigInt(1),
  transcript:
    "Agent: Hello, how can I help you today?\nCustomer: I have a question about my order...",
};

const sampleCallRecord2 = {
  id: BigInt(2),
  startTime: BigInt(Date.now() - 1800000),
  status: CallStatus.inProgress,
  userId: samplePrincipal,
  recipientPhone: "+1 (555) 987-6543",
  callSid: "CA9876543210fedcba",
  presetId: BigInt(2),
};

const sampleAnsweringPreset = {
  id: 1n,
  ownerId: samplePrincipal,
  name: "After-hours support",
  phoneNumber: "+18885550123",
  systemPrompt:
    "You answer calls after hours. Collect the caller's name, reason for calling, and preferred callback time.",
  voice: Voice.eve,
  voiceId: "",
  sampleRate: SampleRate.hz8000,
  audioFormat: AudioFormat.pcmu,
  toolsEnabled: {
    xSearch: false,
    webSearch: false,
    functionCalling: false,
  },
  turnDetection: {
    prefixPaddingMs: 200n,
    threshold: 0.5,
    silenceDurationMs: 500n,
    serverVad: true,
  },
  captureOptions: {
    saveTranscript: true,
    recordAudio: false,
    consentConfirmed: true,
  },
  enabled: true,
  verificationStatus: AnsweringPresetStatus.verified,
  webhookSecret: "mock_answering_secret_01234567890123456789",
  createdAt: BigInt(Date.now() * 1_000_000),
  updatedAt: BigInt(Date.now() * 1_000_000),
  verifiedAt: BigInt(Date.now() * 1_000_000),
};

export const mockBackend: Partial<backendInterface> = {
  _initializeAccessControl: async () => undefined,
  adminAddPromoMinutes: async (_user: Principal, _minutes: bigint) => ({
    __kind__: "ok",
    ok: true,
  }),

  adminGetSystemLogs: async (_limit: bigint) => [
    {
      level: Variant_info_warn_error.info,
      message: "System initialized successfully",
      timestamp: BigInt(Date.now() - 3600000),
    },
    {
      level: Variant_info_warn_error.warn,
      message: "Twilio webhook received unknown status",
      timestamp: BigInt(Date.now() - 1800000),
      callId: BigInt(2),
    },
  ],

  adminListAllCalls: async () => [sampleCallRecord, sampleCallRecord2],

  adminListUserCalls: async (_userId: Principal) => [sampleCallRecord],

  assignCallerUserRole: async (_user: Principal, _role: UserRole) => undefined,

  cancelCallReservation: async (_reservationId: string, _reason: string) => ({
    __kind__: "ok",
    ok: true,
  }),

  createAnsweringPreset: async (input) => ({
    __kind__: "ok",
    ok: {
      ...sampleAnsweringPreset,
      ...input,
      id: 2n,
      ownerId: samplePrincipal,
      verificationStatus: AnsweringPresetStatus.pendingVerification,
      createdAt: BigInt(Date.now() * 1_000_000),
      updatedAt: BigInt(Date.now() * 1_000_000),
    },
  }),

  createPreset: async (_input) => samplePreset,

  createPurchaseIntent: async (packageId: string) => ({
    __kind__: "ok",
    ok: {
      id: "pi_mock",
      user: samplePrincipal,
      packageId,
      amountCents: BigInt(packageId === "pack_20" ? 2000 : packageId === "pack_10" ? 1000 : 500),
      seconds: BigInt(packageId === "pack_20" ? 7200 : packageId === "pack_10" ? 3600 : 1800),
      mode: StripeMode.test,
      createdAt: BigInt(Date.now() * 1_000_000),
      status: PurchaseIntentStatus.pending,
    },
  }),

  deleteAnsweringPreset: async (_id: bigint) => true,

  deletePreset: async (_id: bigint) => true,

  duplicatePreset: async (_id: bigint) => samplePreset,

  getAdminConfig: async () => ({
    hasXaiKey: true,
    hasTwilioAuth: true,
    twilioFromNumber: "+1 (888) 555-0100",
    twilioAccountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    twilioPhoneNumbers: [
      {
        phoneNumber: "+18885550100",
        name: "Primary line",
        enabled: true,
      },
    ],
  }),

  getBillingPackages: async () => [
    { id: "pack_5", name: "$5 - 30 minutes", amountCents: 500n, seconds: 1800n },
    { id: "pack_10", name: "$10 - 60 minutes", amountCents: 1000n, seconds: 3600n },
    { id: "pack_20", name: "$20 - 120 minutes", amountCents: 2000n, seconds: 7200n },
  ],

  getCallRecord: async (_id: bigint) => sampleCallRecord,

  getCallerUserRole: async () => UserRole.admin,

  getAnsweringPreset: async (_id: bigint) => sampleAnsweringPreset,

  getMyBillingStatus: async () => ({
    balanceSeconds: 3600n,
    reservedSeconds: 0n,
    availableSeconds: 3600n,
    packages: [
      { id: "pack_5", name: "$5 - 30 minutes", amountCents: 500n, seconds: 1800n },
      { id: "pack_10", name: "$10 - 60 minutes", amountCents: 1000n, seconds: 3600n },
      { id: "pack_20", name: "$20 - 120 minutes", amountCents: 2000n, seconds: 7200n },
    ],
  }),

  getPreset: async (_id: bigint) => samplePreset,

  initiateCall: async (_input) => ({
    __kind__: "ok",
    ok: {
      callSid: "CA1234567890abcdef",
      callId: BigInt(3),
    },
  }),

  isCallerAdmin: async () => true,

  listMyAnsweringLiveSessions: async () => [],

  listMyAnsweringPresets: async () => [sampleAnsweringPreset],

  listMyCalls: async () => [sampleCallRecord, sampleCallRecord2],

  listMyPresets: async () => [samplePreset, samplePreset2],

  reserveCall: async (input) => ({
    __kind__: "ok",
    ok: {
      id: "res_mock",
      callId: 3n,
      user: samplePrincipal,
      recipientPhone: input.recipientPhone,
      presetId: input.presetId,
      allowedSeconds: 900n,
      callToken: "ct_mock",
      createdAt: BigInt(Date.now() * 1_000_000),
      expiresAt: BigInt((Date.now() + 15 * 60 * 1000) * 1_000_000),
      status: CallReservationStatus.reserved,
    },
  }),

  extendCallReservationForServer: async () => ({
    __kind__: "ok",
    ok: {
      id: "res_mock",
      callId: 3n,
      user: samplePrincipal,
      recipientPhone: "+15551234567",
      presetId: 1n,
      allowedSeconds: 1800n,
      callToken: undefined,
      createdAt: BigInt(Date.now() * 1_000_000),
      expiresAt: BigInt((Date.now() + 15 * 60 * 1000) * 1_000_000),
      status: CallReservationStatus.active,
    },
  }),

  setAdminConfig: async (
    _xaiApiKey: string,
    _twilioAccountSid: string,
    _twilioAuthToken: string,
    _twilioFromNumber: string
  ) => undefined,

  setAnsweringPresetEnabled: async (_id: bigint, enabled: boolean) => ({
    __kind__: "ok",
    ok: { ...sampleAnsweringPreset, enabled },
  }),

  setTwilioLine: async (input) => ({
    __kind__: "ok",
    ok: [input],
  }),

  removeTwilioLine: async (_phoneNumber: string) => ({
    __kind__: "ok",
    ok: [],
  }),

  setTwilioLineEnabled: async (phoneNumber: string, enabled: boolean) => ({
    __kind__: "ok",
    ok: [{ phoneNumber, name: phoneNumber, enabled }],
  }),

  twilioWebhook: async (_callSid: string, _callStatus: string) => "<Response/>",

  requestEndActiveCall: async (callId: bigint) => ({
    __kind__: "ok" as const,
    ok: {
      id: `call:${callId.toString()}`,
      callId,
      reservationId: "",
      callSid: undefined,
      serverSessionId: undefined,
      requestedAt: BigInt(Date.now() * 1_000_000),
      reason: "dashboard_user_requested_end",
    },
  }),

  listPendingCallEndsForServer: async (_limit: bigint) => [],

  clearPendingCallEndForServer: async (_id: string) => true,

  agentEndCall: async (_jobId: string) => ({
    __kind__: "err" as const,
    err: {
      code: "CALL_JOB_NOT_FOUND",
      message: "Mock backend has no MCP call jobs.",
      retryable: false,
      availablePhoneSeconds: 0n,
      pricing: [],
    },
  }),

  updateCallStatus: async (
    _callId: bigint,
    _status: CallStatus,
    _transcript: string | null
  ) => true,

  updateAnsweringPreset: async (_id: bigint, input) => ({
    __kind__: "ok",
    ok: { ...sampleAnsweringPreset, ...input },
  }),

  updateAnsweringPresetInstructions: async (
    _id: bigint,
    systemPrompt: string,
  ) => ({
    __kind__: "ok",
    ok: { ...sampleAnsweringPreset, systemPrompt },
  }),

  updatePresetInstructions: async (_id: bigint, systemPrompt: string) => ({
    __kind__: "ok",
    ok: { ...samplePreset, systemPrompt },
  }),

  updatePreset: async (_id: bigint, _input) => samplePreset,
};
