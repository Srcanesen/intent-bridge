import { BridgeError } from "@intent-bridge/core";
import { describe, expect, it, vi } from "vitest";

import { resolvePiHostAdapter } from "../src/pi-host-adapter.js";
import type { PiModel } from "../src/pi-model-provider.js";

const model: PiModel = {
  id: "model",
  name: "Model",
  provider: "provider",
};
const context = { systemPrompt: "prompt", messages: [], tools: [] };
const options = {
  signal: new AbortController().signal,
  reasoning: "off" as const,
  maxTokens: 1,
  timeoutMs: 1,
  maxRetries: 0,
  maxRetryDelayMs: 0,
  cacheRetention: "none" as const,
};

describe("Pi host adapter", () => {
  it("chooses and binds the public delegate", async () => {
    const registry = {
      value: "public",
      completeSimple(this: { value: string }) {
        return Promise.resolve({ responseId: this.value });
      },
    };
    const adapter = resolvePiHostAdapter(registry);
    await expect(
      adapter.completeSimple(model, context, options),
    ).resolves.toMatchObject({
      responseId: "public",
    });
    expect(adapter.capabilitySource).toBe("public_delegate");
  });

  it("uses and binds the runtime fallback when public is absent", async () => {
    const registry = {
      runtime: {
        value: "runtime",
        completeSimple(this: { value: string }) {
          return Promise.resolve({ responseId: this.value });
        },
      },
    };
    const adapter = resolvePiHostAdapter(registry);
    await expect(
      adapter.completeSimple(model, context, options),
    ).resolves.toMatchObject({
      responseId: "runtime",
    });
    expect(adapter.capabilitySource).toBe("runtime_fallback");
  });

  it("fails with a classified capability error when neither shape is available", () => {
    expect(() => resolvePiHostAdapter({})).toThrow(BridgeError);
    try {
      resolvePiHostAdapter({});
    } catch (error) {
      expect(error).toMatchObject({
        code: "CONFIG_INVALID",
        safeMessage: "The Pi model runtime is unavailable.",
        retryable: false,
      });
    }
  });

  it("does not retry through runtime after a selected public delegate throws", () => {
    const runtime = vi.fn();
    const adapter = resolvePiHostAdapter({
      completeSimple: () => {
        throw new Error("public failed");
      },
      runtime: { completeSimple: runtime },
    });
    expect(() => adapter.completeSimple(model, context, options)).toThrow(
      "public failed",
    );
    expect(runtime).not.toHaveBeenCalled();
  });
});
