import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const environment = JSON.parse(
  readFileSync(resolve("public/env.json"), "utf8"),
);
const voiceUrl = new URL(environment.voice_server_url);
const voiceOrigin = voiceUrl.origin;
const voiceWebSocketOrigin = `${voiceUrl.protocol === "https:" ? "wss:" : "ws:"}//${voiceUrl.host}`;

const connectSources = [
  "'self'",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "ws://localhost:3000",
  "ws://127.0.0.1:3000",
  "https://icp-api.io",
  "https://ic0.app",
  "https://*.ic0.app",
  "https://icp0.io",
  "https://*.icp0.io",
  "https://id.ai",
  "https://identity.internetcomputer.org",
  "https://identity.ic0.app",
  voiceOrigin,
  voiceWebSocketOrigin,
];
const mediaSources = [
  "'self'",
  "data:",
  "blob:",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  voiceOrigin,
];
const unique = (values) => [...new Set(values)].join(" ");
const machineReadableHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300",
};
const csp = [
  "default-src 'self'",
  `connect-src ${unique(connectSources)}`,
  "img-src 'self' data: blob:",
  `media-src ${unique(mediaSources)}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "frame-src https://id.ai https://identity.internetcomputer.org https://identity.ic0.app",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const assetConfig = [
  { match: ".well-known", ignore: false },
  {
    match: "**/*",
    security_policy: "standard",
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Security-Policy": csp,
    },
    allow_raw_access: false,
  },
  {
    match: ".well-known/ic-domains",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    ignore: false,
  },
  {
    match: ".well-known/ii-alternative-origins",
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    },
    ignore: false,
  },
  {
    match: ".well-known/ic-app.json",
    headers: {
      ...machineReadableHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
    ignore: false,
  },
  {
    match: "ic-app.json",
    headers: {
      ...machineReadableHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  },
  {
    match: "agent-guide.json",
    headers: {
      ...machineReadableHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  },
  {
    match: "llms*.txt",
    headers: {
      ...machineReadableHeaders,
      "Content-Type": "text/plain; charset=utf-8",
    },
  },
  {
    match: "agent-api.did",
    headers: {
      ...machineReadableHeaders,
      "Content-Type": "text/plain; charset=utf-8",
    },
  },
  {
    match: "robots.txt",
    headers: {
      ...machineReadableHeaders,
      "Content-Type": "text/plain; charset=utf-8",
    },
  },
  {
    match: "assets/**/*",
    headers: { "Cache-Control": "public, max-age=31536000, immutable" },
  },
  { match: "**/*", enable_aliasing: true },
];

mkdirSync(resolve("dist"), { recursive: true });
writeFileSync(
  resolve("dist/.ic-assets.json5"),
  `${JSON.stringify(assetConfig, null, 2)}\n`,
);
console.log(
  `Generated dist/.ic-assets.json5 for ${voiceOrigin} with raw access disabled.`,
);
