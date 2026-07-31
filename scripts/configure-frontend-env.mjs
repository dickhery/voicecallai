import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mode = (process.argv[2] || "local").toLowerCase();
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function readDotEnv(path) {
  if (!existsSync(path)) return {};
  const output = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [rawKey, ...rawValue] = trimmed.split("=");
    output[rawKey.trim()] = rawValue
      .join("=")
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return output;
}

function getArg(name) {
  const prefix = `--${name}=`;
  const exact = `--${name}`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument.startsWith(prefix)) return argument.slice(prefix.length);
    if (argument === exact) return process.argv[index + 1];
  }
  return undefined;
}

function normalizeUrl(value, defaultProtocol = "https") {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed || trimmed === "undefined") return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${defaultProtocol}://${trimmed}`;
}

function normalizeOrigin(value) {
  const url = normalizeUrl(value);
  return url ? new URL(url).origin : "";
}

function isLocalUrl(value) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(
    String(value || ""),
  );
}

function isPlaceholder(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return (
    !normalized ||
    normalized === "undefined" ||
    normalized.includes("replace-with") ||
    normalized.includes("example.com") ||
    normalized.includes("your-cloudflare") ||
    normalized.includes("yourdomain")
  );
}

function loadMappings(targetMode) {
  const path =
    targetMode === "ic"
      ? resolve(root, ".icp/data/mappings/ic.ids.json")
      : resolve(root, ".icp/cache/mappings/local.ids.json");
  return { path, mappings: readJson(path, {}) };
}

function resolveVoiceServerUrl(targetMode, existingEnvironment) {
  const serverEnvironment = readDotEnv(resolve(root, "src/server/.env"));
  const fromServerHost =
    serverEnvironment.HOSTNAME && !isPlaceholder(serverEnvironment.HOSTNAME)
      ? normalizeUrl(serverEnvironment.HOSTNAME)
      : "";
  const configuredFallback =
    targetMode === "local"
      ? "http://localhost:3000"
      : fromServerHost || existingEnvironment.voice_server_url || "";
  const url = normalizeUrl(
    getArg("voice-server-url") ||
      process.env.VOICE_SERVER_URL ||
      configuredFallback,
    targetMode === "local" ? "http" : "https",
  );

  if (isPlaceholder(url)) {
    throw new Error(
      "Set a real voice server URL with --voice-server-url or VOICE_SERVER_URL.",
    );
  }
  if (targetMode === "ic" && (isLocalUrl(url) || !url.startsWith("https://"))) {
    throw new Error(
      "Mainnet requires a public HTTPS voice server URL. Example: pnpm configure:frontend:ic -- --voice-server-url https://voice.example.com",
    );
  }
  return url;
}

function resolveDerivationOrigin(
  targetMode,
  frontendCanisterId,
  existingEnvironment,
) {
  if (targetMode !== "ic") return "";
  // Prefer the custom domain so web II sessions match MCP Agent Identity
  // principals for the same Internet Identity (voicecallai.online).
  const fallback = "https://voicecallai.online";
  const value =
    getArg("ii-derivation-origin") ||
    process.env.II_DERIVATION_ORIGIN ||
    existingEnvironment.ii_derivation_origin ||
    fallback ||
    (frontendCanisterId ? `https://${frontendCanisterId}.icp0.io` : "");
  return value ? normalizeOrigin(value) : "";
}

if (!["local", "ic"].includes(mode)) {
  throw new Error(
    "Usage: node scripts/configure-frontend-env.mjs <local|ic> [--voice-server-url URL] [--ii-derivation-origin URL]",
  );
}

const environmentPath = resolve(root, "src/frontend/public/env.json");
const existingEnvironment = readJson(environmentPath, {});
const { path: mappingPath, mappings } = loadMappings(mode);
const frontendCanisterId = mappings.frontend;
const voiceServerUrl = resolveVoiceServerUrl(mode, existingEnvironment);
const derivationOrigin = resolveDerivationOrigin(
  mode,
  frontendCanisterId,
  existingEnvironment,
);
const nextEnvironment = {
  voice_server_url: voiceServerUrl,
  ...(derivationOrigin ? { ii_derivation_origin: derivationOrigin } : {}),
};

writeFileSync(
  environmentPath,
  `${JSON.stringify(nextEnvironment, null, 2)}\n`,
);

console.log(`Wrote ${environmentPath}`);
console.log(`Voice server URL: ${voiceServerUrl}`);
if (frontendCanisterId) {
  const frontendUrl =
    mode === "ic"
      ? `https://${frontendCanisterId}.icp0.io`
      : `http://${frontendCanisterId}.localhost:8000`;
  console.log(`Frontend canister: ${frontendCanisterId}`);
  console.log(`Open frontend at: ${frontendUrl}`);
} else {
  console.log(`No frontend canister ID is recorded yet in ${mappingPath}.`);
}
if (derivationOrigin) {
  console.log(`Internet Identity derivation origin: ${derivationOrigin}`);
}
