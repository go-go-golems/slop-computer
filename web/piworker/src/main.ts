// The Pi model worker (ported from francois worker/src/main.ts): JSON lines
// on stdio; init → ready {models}, sample → text/thinking/tool/usage/result
// or error, then ended; cancel and tool_result come back in.
import { OutputBudget } from "./output-budget";
import { ProviderError } from "./provider-error";
import { registerLunaroute } from "./lunaroute";
import { createInterface } from "node:readline";
import { join } from "node:path";
import {
  ModelRuntime,
  SettingsManager,
  resolveCliModel,
  resolveModelScopeWithDiagnostics,
} from "@earendil-works/pi-coding-agent";
import type {
  Api,
  Context,
  Model,
  Tool,
  ToolCall,
  ThinkingLevel,
} from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";

type Init = { agentDir: string; cwd: string; tiers: Record<string, string> };
type Request = {
  callId: string;
  images?: { mimeType: string; data: string }[];
  input: string | { role: "user" | "assistant"; content: string }[];
  options: {
    modelTier: string;
    model?: string;
    effort?: "low" | "medium" | "high";
  };
  tools?: { name: string; description: string; inputSchema?: object }[];
  maxRounds?: number;
  maxOutputTokens?: number;
};
type ToolResult = { value: unknown; isError: boolean };
const controllers = new Map<string, AbortController>();
const waiting = new Map<
  string,
  { resolve: (r: ToolResult) => void; reject: (e: Error) => void }
>();
let runtime!: ModelRuntime;
let models: readonly Model<Api>[] = [];
let selected: Record<string, Model<Api>> = {};
let tierThinking: Record<string, ThinkingLevel | "off" | undefined> = {};
let baseline: ThinkingLevel | undefined;
const emit = (frame: object) =>
  process.stdout.write(JSON.stringify(frame) + "\n");
const publicModel = (m: Model<Api>, tier?: string) => ({
  provider: m.provider,
  id: m.id,
  name: m.name,
  reasoning: m.reasoning,
  images: m.input.includes("image"),
  thinkingLevels: getSupportedThinkingLevels(m),
  tier,
});
async function init(config: Init) {
  runtime = await ModelRuntime.create({
    authPath: join(config.agentDir, "auth.json"),
    modelsPath: join(config.agentDir, "models.json"),
    modelsStorePath: join(config.agentDir, "models-store.json"),
    allowModelNetwork: false,
    signal: AbortSignal.timeout(15_000),
  });
  await registerLunaroute(runtime, config.agentDir);
  const settings = SettingsManager.create(config.cwd, config.agentDir);
  const configuredThinking = settings.getDefaultThinkingLevel();
  baseline = configuredThinking === "off" ? undefined : configuredThinking;
  models = await runtime.getAvailable(undefined, {
    signal: AbortSignal.timeout(15_000),
  });
  const patterns = settings.getEnabledModels();
  const scope = patterns?.length
    ? (
        await resolveModelScopeWithDiagnostics(patterns, runtime)
      ).scopedModels.map((s) => s.model)
    : models;
  const defaultModel = runtime.getModel(
    settings.getDefaultProvider() ?? "",
    settings.getDefaultModel() ?? "",
  );
  const eligible = (m: Model<Api>) =>
    models.some((a) => a.id === m.id && a.provider === m.provider);
  const preferred =
    defaultModel &&
    eligible(defaultModel) &&
    scope.some(
      (s) => s.id === defaultModel.id && s.provider === defaultModel.provider,
    )
      ? defaultModel
      : scope[0];
  selected = {};
  for (const tier of ["quick", "default", "complex"]) {
    const explicit = config.tiers[tier];
    const resolved = explicit
      ? resolveCliModel({ cliModel: explicit, modelRuntime: runtime })
      : undefined;
    const model = resolved?.model ?? (explicit ? undefined : preferred);
    if (!model || !eligible(model))
      throw new Error(
        `No authenticated model for ${tier}. Configure Pi or pass --model-${tier}.`,
      );
    selected[tier] = model;
    tierThinking[tier] = resolved?.thinkingLevel;
  }
  emit({
    type: "ready",
    models: [
      ...Object.entries(selected).map(([tier, m]) => publicModel(m, tier)),
      ...models
        .filter((m) => !Object.values(selected).includes(m))
        .map((m) => publicModel(m)),
    ],
  });
}
function toolResult(
  callId: string,
  tool: ToolCall,
  signal: AbortSignal,
): Promise<ToolResult> {
  const key = callId + "|" + tool.id;
  return new Promise((resolve, reject) => {
    const abort = () => {
      waiting.delete(key);
      reject(new Error("Cancelled"));
    };
    waiting.set(key, {
      resolve: (r) => {
        signal.removeEventListener("abort", abort);
        resolve(r);
      },
      reject,
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    emit({
      type: "tool",
      callId,
      toolCallId: tool.id,
      name: tool.name,
      input: tool.arguments,
    });
  });
}
async function sample(r: Request) {
  const ctl = new AbortController();
  controllers.set(r.callId, ctl);
  let visible = "";
  let thinking = "";
  try {
    let model = selected[r.options.modelTier];
    let applied: string | undefined;
    let requestedThinking = tierThinking[r.options.modelTier];
    if (r.options.model) {
      const resolved = resolveCliModel({
        cliModel: r.options.model,
        modelRuntime: runtime,
      });
      const candidate = resolved.model;
      if (
        candidate &&
        models.some(
          (m) => m.id === candidate.id && m.provider === candidate.provider,
        )
      ) {
        model = candidate;
        applied = r.options.model;
        requestedThinking = resolved.thinkingLevel;
      }
    }
    if (!model) throw new Error("Model unavailable");
    const turns =
      typeof r.input === "string"
        ? [{ role: "user" as const, content: r.input }]
        : r.input;
    if (r.images?.length && !model.input.includes("image"))
      throw new Error("Images are not supported by the selected model");
    const context: Context = {
      messages: turns.map((t) =>
        t.role === "user"
          ? { role: "user", content: t.content, timestamp: Date.now() }
          : {
              role: "assistant",
              content: [{ type: "text", text: t.content }],
              api: model.api,
              provider: model.provider,
              model: model.id,
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  total: 0,
                },
              },
              stopReason: "stop",
              timestamp: Date.now(),
            },
      ),
      tools: (r.tools ?? []).map(
        (t) =>
          ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema ?? { type: "object", properties: {} },
          }) as Tool,
      ),
    };
    if (r.images?.length) {
      const last = context.messages.at(-1);
      if (last?.role === "user") {
        last.content = [
          {
            type: "text",
            text: typeof last.content === "string" ? last.content : "",
          },
          ...r.images.map((image) => ({
            type: "image" as const,
            data: image.data,
            mimeType: image.mimeType,
          })),
        ];
      }
    }
    const outputBudget = new OutputBudget(r.maxOutputTokens);
    const rounds = Math.min(Math.max(r.maxRounds || 5, 1), 10);
    for (let round = 0; round < rounds; round++) {
      if (round === rounds - 1) context.tools = [];
      if (
        Buffer.byteLength(
          JSON.stringify(
            context.messages.map((m) => ({
              ...m,
              content: Array.isArray(m.content)
                ? m.content.filter((c) => c.type !== "image")
                : m.content,
            })),
          ),
        ) >
        512 * 1024
      )
        throw new Error("Tool conversation exceeds local context budget");
      const reasoning =
        r.options.effort ??
        (requestedThinking === "off"
          ? undefined
          : (requestedThinking ??
            (r.options.modelTier === "quick" ? undefined : baseline)));
      const stream = runtime.streamSimple(model, context, {
        signal: ctl.signal,
        reasoning,
        maxTokens: outputBudget.next(model.maxTokens),
      });
      let roundText = "";
      let separated = false;
      let thinkingSeparated = false;
      for await (const event of stream) {
        if (event.type === "thinking_delta") {
          let delta = event.delta;
          if (!thinkingSeparated && round > 0 && thinking)
            delta = "\n\n" + delta;
          thinkingSeparated = true;
          thinking += delta;
          emit({ type: "thinking", callId: r.callId, text: thinking, delta });
        }
        if (event.type === "text_delta") {
          let delta = event.delta;
          if (!separated) {
            if (round > 0 && visible) delta = "\n\n" + delta;
            separated = true;
          }
          roundText += event.delta;
          visible += delta;
          emit({ type: "text", callId: r.callId, text: visible, delta });
        }
      }
      const message = await stream.result();
      outputBudget.consume(message.usage?.output);
      // Private accounting frame; the host aggregates it and never forwards it.
      emit({
        type: "usage",
        callId: r.callId,
        usage: {
          input: message.usage?.input ?? 0,
          output: message.usage?.output ?? 0,
          cacheRead: message.usage?.cacheRead ?? 0,
          cacheWrite: message.usage?.cacheWrite ?? 0,
          cost: message.usage?.cost?.total ?? 0,
          model: model.provider + "/" + model.id,
        },
      });
      if (message.stopReason === "aborted") throw new Error("Cancelled");
      if (message.stopReason === "error")
        throw new ProviderError(
          message.errorMessage ?? "Provider request failed",
        );
      if (message.stopReason === "deferred")
        throw new Error("Deferred provider responses are not supported");
      context.messages.push(message);
      const tools = message.content.filter(
        (c): c is ToolCall => c.type === "toolCall",
      );
      if (!tools.length || outputBudget.remaining <= 0) {
        if (!visible.trim()) throw new Error("Empty completion");
        emit({
          type: "result",
          callId: r.callId,
          result: {
            text: visible,
            thinking,
            finalText: roundText,
            truncated:
              message.stopReason === "length" || outputBudget.remaining <= 0,
            modelTierApplied: r.options.modelTier,
            modelApplied: applied,
            modelUsed: model.provider + "/" + model.id,
          },
        });
        return;
      }
      const results = await Promise.all(
        tools.map(async (tool) => {
          if (!r.tools?.some((t) => t.name === tool.name))
            throw new Error("Unknown page tool");
          const result = await toolResult(r.callId, tool, ctl.signal);
          return {
            role: "toolResult" as const,
            toolCallId: tool.id,
            toolName: tool.name,
            content: [
              {
                type: "text" as const,
                text:
                  typeof result.value === "string"
                    ? result.value
                    : JSON.stringify(result.value),
              },
            ],
            isError: result.isError,
            timestamp: Date.now(),
          };
        }),
      );
      context.messages.push(...results);
    }
    throw new Error("Tool round limit reached");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Model request failed";
    const provider =
      error instanceof ProviderError ? error : new ProviderError(message);
    const localMessages = [
      "Images are not supported by the selected model",
      "Tool conversation exceeds local context budget",
      "Empty completion",
      "Tool round limit reached",
      "Deferred provider responses are not supported",
      "Unknown page tool",
      "Model unavailable",
    ];
    const code = ctl.signal.aborted
      ? "cancelled"
      : message.includes("Images are not supported")
        ? "images_unavailable"
        : message.includes("context budget")
          ? "prompt_too_large"
          : message === "Empty completion"
            ? "empty_completion"
            : provider.code;
    emit({
      type: "error",
      callId: r.callId,
      error: {
        code,
        message: ctl.signal.aborted
          ? "Stopped"
          : localMessages.includes(message)
            ? message
            : provider.message,
        text: visible || undefined,
      },
    });
  } finally {
    ctl.abort();
    controllers.delete(r.callId);
    for (const [key, p] of waiting) {
      if (key.startsWith(r.callId + "|")) {
        p.reject(new Error("Call ended"));
        waiting.delete(key);
      }
    }
    emit({ type: "ended", callId: r.callId });
  }
}
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  try {
    const frame = JSON.parse(line);
    if (frame.type === "init") {
      await init(frame);
    } else if (frame.type === "sample") {
      if (!runtime) throw new Error("Worker not initialized");
      void sample(frame);
    } else if (frame.type === "cancel") {
      controllers.get(frame.callId)?.abort();
    } else if (frame.type === "tool_result") {
      const key = frame.callId + "|" + frame.toolCallId;
      const p = waiting.get(key);
      if (p) {
        waiting.delete(key);
        p.resolve(frame);
      }
    }
  } catch (error) {
    emit({
      type: "fatal",
      error: {
        code: "upstream_error",
        message:
          error instanceof Error
            ? error.message
            : "Worker initialization failed",
      },
    });
    process.exitCode = 1;
    break;
  }
}
for (const ctl of controllers.values()) ctl.abort();
