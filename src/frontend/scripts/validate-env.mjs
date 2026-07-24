import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const environmentPath = resolve("public/env.json");
let environment;

try {
  environment = JSON.parse(readFileSync(environmentPath, "utf8"));
} catch (error) {
  throw new Error(
    [
      `Unable to read ${environmentPath}: ${error.message}`,
      "Create it with one of:",
      "  pnpm configure:frontend:local",
      "  pnpm configure:frontend:ic -- --voice-server-url https://voice.example.com",
    ].join("\n"),
  );
}

function isPlaceholder(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return (
    !normalized ||
    normalized.includes("replace-with") ||
    normalized.includes("example.com") ||
    normalized.includes("yourdomain") ||
    normalized.includes("your-cloudflare")
  );
}

function requireHttpUrl(value, label, { allowLocalHttp = false } = {}) {
  if (isPlaceholder(value)) {
    throw new Error(`${label} is missing or still contains a placeholder.`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute http(s) URL.`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${label} must use http or https.`);
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(allowLocalHttp && local)) {
    throw new Error(`${label} must use HTTPS unless it points to localhost.`);
  }
  return url;
}

const voiceServer = requireHttpUrl(
  environment.voice_server_url,
  "voice_server_url",
  { allowLocalHttp: true },
);

if (environment.ii_derivation_origin) {
  const derivationOrigin = requireHttpUrl(
    environment.ii_derivation_origin,
    "ii_derivation_origin",
    { allowLocalHttp: true },
  );
  if (derivationOrigin.pathname !== "/" || derivationOrigin.search) {
    throw new Error("ii_derivation_origin must be an origin without a path.");
  }
}

const forbiddenKeys = Object.keys(environment).filter((key) =>
  /api.?key|secret|token|password/i.test(key),
);
if (forbiddenKeys.length > 0) {
  throw new Error(
    `public/env.json cannot contain secrets (${forbiddenKeys.join(", ")}). Put server credentials in src/server/.env.`,
  );
}

console.log(`Runtime environment validated (${voiceServer.origin}).`);
