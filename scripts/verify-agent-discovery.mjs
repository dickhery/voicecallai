import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const target = process.argv[2] || resolve("src/frontend/dist");
const expectedFiles = [
  "llms.txt",
  "llms-full.txt",
  "agent-guide.json",
  ".well-known/ic-app.json",
  "ic-app.json",
  "agent-api.did",
  "robots.txt",
  "guide.html",
  "sitemap.xml",
  ".well-known/ii-derivation-origin",
  ".well-known/ic-architecture",
];
const isRemoteTarget =
  target.startsWith("http://") || target.startsWith("https://");

function assertValid(relativePath, body, contentType = "") {
  if (!body.trim()) {
    throw new Error(`${relativePath} is empty.`);
  }
  if (isRemoteTarget) {
    const expectedContentType = (relativePath.endsWith(".json") || relativePath === ".well-known/ic-architecture")
      ? "application/json"
      : relativePath.endsWith(".html") ? "text/html"
      : relativePath.endsWith(".xml") ? "application/xml" : "text/plain";
    if (!contentType.includes(expectedContentType)) {
      throw new Error(
        `${relativePath} returned ${contentType || "no content type"} instead of ${expectedContentType}.`,
      );
    }
  }
  if (relativePath === ".well-known/ic-architecture") {
    const manifest = JSON.parse(body);
    const expected = JSON.parse(readFileSync(resolve(".icp/data/mappings/ic.ids.json"), "utf8"));
    if (manifest.version !== "1.0.0" || !Array.isArray(manifest.canisters) ||
        manifest.canisters.length !== 2 ||
        !["frontend", "backend"].every((name) => manifest.canisters.some(
          (entry) => entry.name === name && entry.id === expected[name] && entry.role,
        ))) {
      throw new Error("ICP MCP manifest must declare exactly the deployed frontend and backend with their roles.");
    }
  }
  if (relativePath === "guide.html" && (!body.includes("Stripe") || !body.includes("mcp.internetcomputer.org/mcp"))) {
    throw new Error("Public guide is missing payment or connector setup.");
  }
  if (relativePath === ".well-known/ii-derivation-origin" && body.trim() !== "https://voicecallai.online") {
    throw new Error("Unexpected production derivation origin.");
  }
  if (
    relativePath === "llms.txt" &&
    (!body.includes("getAgentGuide") ||
      !body.includes("agentQueueCall") ||
      !body.includes("agentGetLiveCallLink") ||
      !body.includes("Backend agent API canister"))
  ) {
    throw new Error("llms.txt is missing required discovery instructions.");
  }
  if (
    relativePath === ".well-known/ic-app.json" &&
    !JSON.parse(body).backend_canister_id
  ) {
    throw new Error("ic-app.json does not declare a backend canister.");
  }
  if (
    relativePath === "agent-api.did" &&
    (!body.includes("agentQueueCall") ||
      !body.includes("agentGetLiveCallLink"))
  ) {
    throw new Error(
      "agent-api.did does not expose the required call and live-listen methods.",
    );
  }
}

if (isRemoteTarget) {
  for (const relativePath of expectedFiles) {
    const url = new URL(relativePath, `${target.replace(/\/+$/, "")}/`);
    const response = await fetch(url, {
      headers: { Accept: "text/plain, application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}.`);
    }
    const body = await response.text();
    if (!relativePath.endsWith(".html") && response.headers.get("access-control-allow-origin") !== "*") {
      throw new Error(`${url} does not allow cross-origin agent reads.`);
    }
    assertValid(
      relativePath,
      body,
      response.headers.get("content-type") || "",
    );
  }
} else {
  for (const relativePath of expectedFiles) {
    const filePath = resolve(target, relativePath);
    if (!existsSync(filePath)) {
      throw new Error(`${filePath} does not exist.`);
    }
    assertValid(relativePath, readFileSync(filePath, "utf8"));
  }
}

console.log(`Verified ${expectedFiles.length} agent discovery files at ${target}.`);
