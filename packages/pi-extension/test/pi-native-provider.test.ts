import { createHash } from "node:crypto";

import {
  InterpretationPipeline,
  PiCompilerV1,
  type BridgeInput,
} from "@intent-bridge/core";
import { describe, expect, it, vi } from "vitest";

import {
  completeSimpleFor,
  createPiProvider,
} from "../src/pi-native-provider.js";
import type { PiModel } from "../src/pi-model-provider.js";

const model: PiModel = {
  id: "model",
  name: "Model",
  provider: "provider",
  input: ["text"],
  contextWindow: 1000,
  maxTokens: 9000,
};
const intent = {
  schemaVersion: "1",
  sourceLanguage: { code: "tr", confidence: 1 },
  responseLanguage: { code: "tr" },
  messageType: "initial",
  goal: "Test",
  tasks: [
    {
      id: "test",
      objective: "Test",
      scope: [],
      constraints: [],
      successCriteria: [],
    },
  ],
  globalConstraints: [],
  assumptions: [],
  ambiguities: [],
  risk: { level: "low", reasons: [] },
  confidence: 1,
  clarification: { recommended: false },
};
const request = {
  schemaVersion: "1" as const,
  originalText: "SENTINEL_REQUEST",
  messageType: "initial" as const,
  attachmentSummary: { imageCount: 0 },
  projectContext: { instructionExcerpts: [] },
  outputRequirements: {
    contentLanguage: "en" as const,
    preserveResponseLanguage: true,
    strictSchema: true,
    implementationCodeForbidden: true,
  },
};

describe("PiNativeProvider", () => {
  it("uses the public delegate once with production thinking off and tool output", async () => {
    const completeSimple = vi.fn().mockResolvedValue({
      stopReason: "toolUse",
      responseId: "response-1",
      usage: { input: 2, output: 3, totalTokens: 5 },
      content: [
        { type: "thinking", thinking: "SENTINEL_THINKING" },
        { type: "text", text: "SENTINEL_EXPLANATORY_TEXT" },
        {
          type: "toolCall",
          name: "emit_intent",
          arguments: { intentJson: JSON.stringify(intent) },
        },
      ],
    });
    const result = await createPiProvider({ completeSimple }, model).interpret(
      request,
      {},
    );
    expect(completeSimple).toHaveBeenCalledTimes(1);
    expect(completeSimple).toHaveBeenCalledWith(
      model,
      expect.objectContaining({
        systemPrompt: expect.stringContaining(
          "Canonical IntentDocument schema",
        ),
        messages: [
          expect.objectContaining({
            content: expect.stringContaining("SENTINEL_REQUEST"),
          }),
        ],
      }),
      expect.objectContaining({
        reasoning: "off",
        maxRetries: 0,
        maxRetryDelayMs: 0,
        cacheRetention: "none",
        maxTokens: 4096,
        timeoutMs: 30000,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(completeSimple.mock.calls[0]?.[2]).not.toHaveProperty("temperature");
    expect(result).toMatchObject({
      requestId: "response-1",
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    });
    expect(result.rawResponseHash).toBe(
      createHash("sha256").update(JSON.stringify(intent)).digest("hex"),
    );
    expect(JSON.stringify(result)).not.toContain("SENTINEL_THINKING");
    expect(JSON.stringify(result)).not.toContain("SENTINEL_EXPLANATORY_TEXT");
  });

  it("reports only the selected capability source", () => {
    const capabilityDiagnostic = vi.fn();
    createPiProvider({ completeSimple: vi.fn() }, model, {
      capabilityDiagnostic,
    });
    expect(capabilityDiagnostic).toHaveBeenCalledOnce();
    expect(capabilityDiagnostic).toHaveBeenCalledWith({
      capabilitySource: "public_delegate",
    });
    expect(JSON.stringify(capabilityDiagnostic.mock.calls)).not.toContain(
      "SENTINEL_REQUEST",
    );
  });

  it("uses the Pi 0.80.10 runtime compatibility shim and fenced text fallback", async () => {
    const completeSimple = vi.fn().mockResolvedValue({
      stopReason: "stop",
      content: [
        { type: "text", text: `\`\`\`json\n${JSON.stringify(intent)}\n\`\`\`` },
      ],
    });
    await expect(
      createPiProvider({ runtime: { completeSimple } }, model).interpret(
        request,
        {},
      ),
    ).resolves.toMatchObject({ intent });
    expect(completeSimple).toHaveBeenCalledTimes(1);
  });

  it.each([
    { stopReason: "length", content: [] },
    { stopReason: "error", content: [] },
    { stopReason: "aborted", content: [] },
    {
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          name: "emit_intent",
          arguments: { intentJson: "{}" },
        },
        { type: "toolCall", name: "other", arguments: {} },
      ],
    },
    {
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          name: "other",
          arguments: { intentJson: JSON.stringify(intent) },
        },
      ],
    },
    {
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          name: "emit_intent",
          arguments: { intentJson: "" },
        },
      ],
    },
  ])("fails safely for invalid native output", async (response) => {
    const completeSimple = vi.fn().mockResolvedValue(response);
    await expect(
      createPiProvider({ completeSimple }, model).interpret(request, {}),
    ).rejects.toMatchObject({
      code: expect.stringMatching(
        /PROVIDER_(UNREACHABLE|INVALID_JSON|RESPONSE_TOO_LARGE)/,
      ),
    });
  });

  it("does not retry a length-stopped response through production retry policy", async () => {
    const completeSimple = vi.fn().mockResolvedValue({
      stopReason: "length",
      content: [],
    });
    const bridgeInput: BridgeInput = {
      traceId: "length",
      receivedAt: "2026-07-19T12:00:00.000Z",
      harness: "pi",
      messageType: "initial",
      source: "interactive",
      originalText: "Keep this original.",
      attachmentSummary: { imageCount: 0 },
      project: { instructionExcerpts: [] },
    };
    await expect(
      new InterpretationPipeline(
        createPiProvider({ completeSimple }, model),
        new PiCompilerV1(),
      ).run(bridgeInput, {
        mode: "auto",
        logging: { mode: "off", retentionDays: 1 },
        providerProfileId: "pi:provider",
        model: model.id,
        retryPolicy: { maxRetries: 1, baseDelayMs: 1, totalBudgetMs: 1000 },
      }),
    ).resolves.toEqual({
      status: "fail_open",
      originalText: "Keep this original.",
      errorCode: "PROVIDER_RESPONSE_TOO_LARGE",
      traceId: "length",
    });
    expect(completeSimple).toHaveBeenCalledTimes(1);
  });

  it("keeps completeSimpleFor as an adapter-backed benchmark compatibility export", async () => {
    const completeSimple = vi.fn().mockResolvedValue({ content: [] });
    const call = completeSimpleFor({ runtime: { completeSimple } });
    await call(
      model,
      { systemPrompt: "", messages: [], tools: [] },
      {
        signal: new AbortController().signal,
        reasoning: "off",
        maxTokens: 1,
        timeoutMs: 1,
        maxRetries: 0,
        maxRetryDelayMs: 0,
        cacheRetention: "none",
      },
    );
    expect(completeSimple).toHaveBeenCalledTimes(1);
  });

  it("maps caller abort/native errors safely and testConnection makes one call", async () => {
    const completeSimple = vi
      .fn()
      .mockRejectedValue(new Error("SENTINEL_ERROR"));
    const provider = createPiProvider({ completeSimple }, model);
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider.interpret(request, { signal: controller.signal }),
    ).rejects.toMatchObject({
      code: "PROVIDER_UNREACHABLE",
      safeMessage: expect.not.stringContaining("SENTINEL"),
    });
    completeSimple.mockResolvedValueOnce({
      stopReason: "stop",
      content: [{ type: "text", text: JSON.stringify(intent) }],
    });
    await provider.testConnection({});
    expect(completeSimple).toHaveBeenCalledTimes(2);
  });
});
