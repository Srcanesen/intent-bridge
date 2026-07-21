import { BridgeError } from "@intent-bridge/core";

import type { PiModel } from "./pi-model-provider.js";

export type PiHostCapabilitySource = "public_delegate" | "runtime_fallback";

export type PiNativeContent =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; name: string; arguments: Record<string, unknown> };
export type PiNativeResponse = {
  content?: readonly PiNativeContent[];
  usage?: { input?: unknown; output?: unknown; totalTokens?: unknown };
  responseId?: unknown;
  stopReason?: unknown;
};
export type PiNativeContext = {
  systemPrompt: string;
  messages: unknown[];
  tools: unknown[];
};
export type PiNativeOptions = {
  signal: AbortSignal;
  reasoning: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens: number;
  timeoutMs: number;
  maxRetries: number;
  maxRetryDelayMs: number;
  cacheRetention: "none";
};
export type CompleteSimple = (
  model: PiModel,
  context: PiNativeContext,
  options: PiNativeOptions,
) => Promise<PiNativeResponse>;

export interface PiHostAdapter {
  capabilitySource: PiHostCapabilitySource;
  completeSimple: CompleteSimple;
}

function unavailable(): never {
  throw new BridgeError({
    code: "CONFIG_INVALID",
    safeMessage: "The Pi model runtime is unavailable.",
    retryable: false,
  });
}

/** Resolves the two Pi 0.80.10 completion shapes once, before any request. */
export function resolvePiHostAdapter(registry: unknown): PiHostAdapter {
  if (typeof registry !== "object" || registry === null) unavailable();
  const host = registry as { completeSimple?: unknown; runtime?: unknown };
  if (typeof host.completeSimple === "function")
    return {
      capabilitySource: "public_delegate",
      completeSimple: host.completeSimple.bind(host) as CompleteSimple,
    };
  const runtime = host.runtime;
  if (typeof runtime !== "object" || runtime === null) unavailable();
  const completeSimple = (runtime as { completeSimple?: unknown })
    .completeSimple;
  if (typeof completeSimple !== "function") unavailable();
  return {
    capabilitySource: "runtime_fallback",
    completeSimple: completeSimple.bind(runtime) as CompleteSimple,
  };
}
