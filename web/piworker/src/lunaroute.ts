import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

// Provider registration required to restore Pi's cached LunaRoute catalog.
// OAuth key semantics follow @lunaroute/pi-extension 0.7.2 src/login.ts:
// access is the gateway key and refreshToken returns the existing credential.
// Login remains a Pi operation; no coding-agent extensions or tools are loaded.
export async function registerLunaroute(
  runtime: ModelRuntime,
  agentDir: string,
) {
  let catalog: { lunaroute?: { models?: { baseUrl?: string }[] } };
  try {
    catalog = JSON.parse(
      await readFile(join(agentDir, "models-store.json"), "utf8"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!catalog.lunaroute?.models?.length) return;
  const session = randomUUID();
  runtime.registerProvider("lunaroute", {
    name: "LunaRoute",
    api: "openai-completions",
    baseUrl:
      catalog.lunaroute.models[0].baseUrl ?? "https://gw.lunaroute.com/v1",
    authHeader: true,
    headers: {
      "lunaroute-agent": "slop",
      "x-lunaroute-session": session,
      "lunaroute-session-id": session,
    },
    oauth: {
      name: "LunaRoute",
      async login() {
        throw new Error("Log in to lunaroute using Pi, then restart slop.");
      },
      async refreshToken(credentials) {
        return credentials;
      },
      getApiKey(credentials) {
        return credentials.access;
      },
    },
    async refreshModels(context) {
      return context.stored ? [...context.stored.models] : [];
    },
  });
  await runtime.refresh({
    allowNetwork: false,
    signal: AbortSignal.timeout(15_000),
  });
}
