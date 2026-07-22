import { createHash } from "node:crypto";

import {
  GroundedInterpretationEnvelopeV1JsonSchema,
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
  schemaVersion: "2",
  sourceLanguage: { code: "tr", confidence: 1 },
  responseLanguage: { code: "tr", source: "source_language_default" },
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
const evidenceFor = (quote: string) => ({
  version: 1 as const,
  items: ["/goal", "/tasks/0/objective"].map((path) => ({
    path,
    source: "user_original" as const,
    quote,
  })),
});
const envelopeFor = (quote: string) => ({
  version: 1,
  groundedIntent: {
    ...intent,
    goal: { value: intent.goal, evidence: { source: "user_original", quote } },
    tasks: intent.tasks.map((task) => ({
      ...task,
      objective: {
        value: task.objective,
        evidence: { source: "user_original", quote },
      },
      scope: [],
      constraints: [],
      successCriteria: [],
    })),
    globalConstraints: [],
  },
});

const request = {
  schemaVersion: "2" as const,
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
          name: "emit_grounded_intent",
          arguments: envelopeFor("SENTINEL_REQUEST"),
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
          "GroundedInterpretationEnvelopeV1 schema",
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
        timeoutMs: 60000,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(completeSimple.mock.calls[0]?.[2]).not.toHaveProperty("temperature");
    const outbound = completeSimple.mock.calls[0]?.[1];
    const system = outbound?.systemPrompt ?? "";
    const user = outbound?.messages[0]?.content ?? "{}";
    expect(JSON.parse(user)).toEqual({
      messageType: request.messageType,
      originalText: request.originalText,
      attachmentSummary: request.attachmentSummary,
      projectContext: request.projectContext,
    });
    for (const metadata of [
      "outputRequirements",
      "implementationCodeForbidden",
      "interpreterPromptVersion",
      "intentSchemaVersion",
    ]) {
      expect(user).not.toContain(metadata);
    }
    expect(system).toContain("interpreterPromptVersion: pi-native-v6");
    expect(system).toContain("exact substring");
    expect(system).toContain("Evidence proves attribution only");
    expect(system).toContain("material ask_user ambiguity");
    expect(system).not.toContain("outputRequirements");
    expect(system).not.toContain("implementationCodeForbidden");
    expect(`${system}\n${user}`).not.toContain(
      "Do not write implementation code",
    );
    expect(outbound?.tools).toEqual([
      {
        name: "emit_grounded_intent",
        description: "Emit exactly one GroundedInterpretationEnvelopeV1.",
        parameters: GroundedInterpretationEnvelopeV1JsonSchema,
      },
    ]);
    expect(JSON.stringify(outbound?.tools)).not.toContain("intentJson");
    expect(JSON.stringify(outbound?.tools)).not.toContain("evidenceJson");
    expect(JSON.stringify(outbound?.tools)).not.toContain('"path"');
    expect(JSON.stringify(outbound?.tools)).not.toContain('"emit_intent"');
    expect(result).toMatchObject({
      intent,
      evidence: evidenceFor("SENTINEL_REQUEST"),
      requestId: "response-1",
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    });
    expect(result.rawResponseHash).toBe(
      createHash("sha256")
        .update(JSON.stringify(envelopeFor("SENTINEL_REQUEST")))
        .digest("hex"),
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
        {
          type: "text",
          text: `\`\`\`json\n${JSON.stringify(envelopeFor("SENTINEL_REQUEST"))}\n\`\`\``,
        },
      ],
    });
    await expect(
      createPiProvider({ runtime: { completeSimple } }, model).interpret(
        request,
        {},
      ),
    ).resolves.toMatchObject({
      intent,
      evidence: evidenceFor("SENTINEL_REQUEST"),
    });
    expect(completeSimple).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "legacy string arguments",
      arguments: { intentJson: "{}", evidenceJson: "{}" },
    },
    {
      name: "legacy sidecar arguments",
      arguments: { intent, evidence: evidenceFor("SENTINEL_REQUEST") },
    },
    { name: "missing arguments", arguments: { version: 1 } },
    {
      name: "extra arguments",
      arguments: { ...envelopeFor("SENTINEL_REQUEST"), unknown: true },
    },
  ])("rejects $name", async ({ arguments: args }) => {
    const completeSimple = vi.fn().mockResolvedValue({
      stopReason: "toolUse",
      content: [
        { type: "toolCall", name: "emit_grounded_intent", arguments: args },
      ],
    });
    await expect(
      createPiProvider({ completeSimple }, model).interpret(request, {}),
    ).rejects.toMatchObject({ code: "PROVIDER_INVALID_JSON" });
  });

  it.each([
    {
      name: "wrong tool",
      content: [
        {
          type: "toolCall",
          name: "emit_intent",
          arguments: envelopeFor("SENTINEL_REQUEST"),
        },
        { type: "text", text: JSON.stringify(envelopeFor("SENTINEL_REQUEST")) },
      ],
    },
    {
      name: "multiple calls",
      content: [
        {
          type: "toolCall",
          name: "emit_grounded_intent",
          arguments: envelopeFor("SENTINEL_REQUEST"),
        },
        { type: "toolCall", name: "other", arguments: {} },
      ],
    },
  ])("rejects $name", async ({ content }) => {
    const completeSimple = vi
      .fn()
      .mockResolvedValue({ stopReason: "toolUse", content });
    await expect(
      createPiProvider({ completeSimple }, model).interpret(request, {}),
    ).rejects.toMatchObject({ code: "PROVIDER_INVALID_JSON" });
  });

  it.each([
    {
      name: "a stale intent object",
      arguments: {
        ...envelopeFor("SENTINEL_REQUEST"),
        groundedIntent: {
          ...envelopeFor("SENTINEL_REQUEST").groundedIntent,
          schemaVersion: "1",
        },
      },
    },
    {
      name: "an invalid evidence quote",
      arguments: envelopeFor("not in source"),
    },
    {
      name: "an unknown grounding field",
      arguments: {
        ...envelopeFor("SENTINEL_REQUEST"),
        groundedIntent: {
          ...envelopeFor("SENTINEL_REQUEST").groundedIntent,
          goal: {
            ...envelopeFor("SENTINEL_REQUEST").groundedIntent.goal,
            path: "/goal",
          },
        },
      },
    },
  ])("fails closed for $name", async ({ arguments: args }) => {
    const completeSimple = vi.fn().mockResolvedValue({
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          name: "emit_grounded_intent",
          arguments: args,
        },
      ],
    });
    await expect(
      createPiProvider({ completeSimple }, model).interpret(request, {}),
    ).rejects.toMatchObject({ code: "INTENT_SCHEMA_INVALID" });
  });

  it.each([
    { stopReason: "length", content: [] },
    { stopReason: "error", content: [] },
    { stopReason: "aborted", content: [] },
  ])("fails safely for terminal native output", async (response) => {
    const completeSimple = vi.fn().mockResolvedValue(response);
    await expect(
      createPiProvider({ completeSimple }, model).interpret(request, {}),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/PROVIDER_(UNREACHABLE|RESPONSE_TOO_LARGE)/),
    });
  });

  it.each([
    JSON.stringify(intent),
    JSON.stringify({ intent, evidence: evidenceFor("SENTINEL_REQUEST") }),
    JSON.stringify(envelopeFor("not in source")),
    JSON.stringify({ ...envelopeFor("SENTINEL_REQUEST"), unknown: true }),
  ])("rejects bare or invalid text envelopes", async (text) => {
    const completeSimple = vi.fn().mockResolvedValue({
      stopReason: "stop",
      content: [{ type: "text", text }],
    });
    await expect(
      createPiProvider({ completeSimple }, model).interpret(request, {}),
    ).rejects.toMatchObject({
      code: expect.stringMatching(
        /PROVIDER_INVALID_JSON|INTENT_SCHEMA_INVALID/,
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

  it("keeps response-envelope controls out of user intent", async () => {
    const completeSimple = vi.fn().mockResolvedValue({
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          name: "emit_grounded_intent",
          arguments: envelopeFor("SENTINEL_REQUEST"),
        },
      ],
    });
    await createPiProvider({ completeSimple }, model).interpret(request, {});
    const systemPrompt = completeSimple.mock.calls[0]?.[1]?.systemPrompt;
    expect(systemPrompt).toMatch(
      /response-envelope controls must not appear as a user goal, scope, constraint, assumption, or ambiguity/i,
    );
    expect(systemPrompt).toContain(
      "Never perform the requested work inside the response",
    );
    expect(systemPrompt).not.toContain("Do not write implementation code");
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
      content: [
        {
          type: "text",
          text: JSON.stringify(
            envelopeFor("Return a minimal valid intent document"),
          ),
        },
      ],
    });
    await provider.testConnection({});
    expect(completeSimple).toHaveBeenCalledTimes(2);
  });
});
