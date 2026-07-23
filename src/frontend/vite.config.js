import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { icpBindgen } from "@icp-sdk/bindgen/plugins/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const environment = process.env.ICP_ENVIRONMENT || "local";

function runIcp(args) {
  return execFileSync("icp", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function getDevServerConfig() {
  try {
    const networkStatus = JSON.parse(
      runIcp(["network", "status", "-e", environment, "--json"]),
    );
    const backendCanisterId = runIcp([
      "canister",
      "status",
      "backend",
      "-e",
      environment,
      "-i",
    ]);
    const canisterParameters = `PUBLIC_CANISTER_ID:backend=${backendCanisterId}`;
    const cookieValue = encodeURIComponent(
      `${canisterParameters}&ic_root_key=${networkStatus.root_key}`,
    );

    return {
      headers: {
        "Set-Cookie": `ic_env=${cookieValue}; SameSite=Lax;`,
      },
      proxy: {
        "/api": {
          target: networkStatus.api_url,
          changeOrigin: true,
        },
      },
    };
  } catch (error) {
    const detail =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr).trim()
        : String(error);
    throw new Error(
      [
        `Unable to configure the Vite server for ICP environment "${environment}".`,
        "Start the local network and deploy the backend first:",
        "  icp network start -d",
        "  pnpm deploy:local -- backend",
        detail,
      ].join("\n"),
    );
  }
}

export default defineConfig(({ command }) => ({
  logLevel: "error",
  build: {
    emptyOutDir: true,
    sourcemap: false,
    // Minify production assets to keep the asset canister smaller and
    // reduce storage-related cycle burn on mainnet.
    minify: "esbuild",
  },
  css: {
    postcss: "./postcss.config.js",
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
  plugins: [
    icpBindgen({
      didFile: "../backend/dist/backend.did",
      outDir: "./src/bindings",
    }),
    react(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  ...(command === "serve" ? { server: getDevServerConfig() } : {}),
}));
