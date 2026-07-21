import { describe, expect, it, vi } from "vitest";

import {
  BridgeError,
  type BridgeInput,
  DEFAULT_QUALITY_CONFIG,
  type HarnessCompiler,
  InterpretationPipeline,
  type IntentDocumentV1,
  type IntentProvider,
  type TraceSink,
  calculateQualitySignals,
  estimateCostUsd,
} from "../src/index.js";
import { validIntent } from "./fixtures/intent.js";

const input = (
  project: BridgeInput["project"] = {
    name: "demo",
    instructionExcerpts: [],
  },
): BridgeInput => ({
  traceId: "trace-1",
  receivedAt: "2026-07-19T12:00:00.000Z",
  harness: "pi",
  messageType: "initial",
  source: "interactive",
  originalText: "Fix the profile layout.",
  attachmentSummary: { imageCount: 1 },
  project,
});

const options = {
  mode: "auto" as const,
  logging: { mode: "metadata" as const, retentionDays: 30 },
  quality: { ...DEFAULT_QUALITY_CONFIG },
  providerProfileId: "test",
  model: "test-model",
  promptVersion: "v1",
};

const provider = (intent = validIntent()): IntentProvider => ({
  id: "test",
  interpret: vi.fn().mockResolvedValue({
    intent,
    rawResponseHash: "hash",
    latencyMs: 12,
  }),
  testConnection: vi.fn(),
});

const compiler = (): HarnessCompiler<IntentDocumentV1> => ({
  compile: vi.fn().mockReturnValue({
    compilerVersion: "pi-v1",
    text: "compiled task",
    responseLanguageCode: "tr",
  }),
});

describe("InterpretationPipeline", () => {
  it("builds the exact request, transforms once, and retains the full latest result", async () => {
    const testProvider = provider();
    const testCompiler = compiler();
    const traceSink: TraceSink = {
      append: vi.fn().mockResolvedValue(undefined),
    };
    const pipeline = new InterpretationPipeline(
      testProvider,
      testCompiler,
      traceSink,
      () => new Date("2026-07-19T12:00:01.000Z"),
    );

    await expect(pipeline.run(input(), options)).resolves.toMatchObject({
      status: "transformed",
      compiledTask: "compiled task",
      assessment: {
        policyVersion: "quality-policy-v1",
        outcome: "accept",
        reasons: [],
        observedConfidence: 0.9,
      },
      traceId: "trace-1",
    });
    expect(testProvider.interpret).toHaveBeenCalledTimes(1);
    expect(testCompiler.compile).toHaveBeenCalledTimes(1);
    expect(testProvider.interpret).toHaveBeenCalledWith(
      {
        schemaVersion: "2",
        originalText: "Fix the profile layout.",
        messageType: "initial",
        attachmentSummary: { imageCount: 1 },
        projectContext: { name: "demo", instructionExcerpts: [] },
        outputRequirements: {
          contentLanguage: "en",
          preserveResponseLanguage: true,
          strictSchema: true,
          implementationCodeForbidden: true,
        },
      },
      {},
    );
    expect(pipeline.getLatest()).toMatchObject({
      originalText: "Fix the profile layout.",
      compiledTask: { text: "compiled task" },
      traceId: "trace-1",
    });
    expect(traceSink.append).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "trace-1",
        timestamp: "2026-07-19T12:00:01.000Z",
        providerProfile: "test",
        model: "test-model",
        status: "success",
        quality: expect.objectContaining({ compilerValid: true }),
        assessment: {
          policyVersion: "quality-policy-v1",
          outcome: "accept",
          reasons: [],
          observedConfidence: 0.9,
        },
      }),
      { mode: "metadata", retentionDays: 30 },
    );
    const latest = pipeline.getLatest();
    expect(latest?.assessment).toEqual({
      policyVersion: "quality-policy-v1",
      outcome: "accept",
      reasons: [],
      observedConfidence: 0.9,
    });
  });

  it("exposes privacy-safe assessment metadata in trace and latest transformation without changing delivery", async () => {
    const reviewIntent: IntentDocumentV1 = {
      ...validIntent(),
      risk: { level: "high", reasons: ["x"] },
      clarification: { recommended: true, reason: "needs confirmation" },
      ambiguities: [
        {
          description: "spec missing",
          material: true,
          preferredResolution: "ask_user",
        },
      ],
      confidence: 0.1,
    };
    const pipeline = new InterpretationPipeline(
      provider(reviewIntent),
      compiler(),
    );

    await expect(
      pipeline.run(input(), {
        ...options,
        quality: { ...DEFAULT_QUALITY_CONFIG, minConfidence: 0.5 },
      }),
    ).resolves.toMatchObject({
      status: "transformed",
      compiledTask: "compiled task",
    });
    const latest = pipeline.getLatest();
    expect(latest?.assessment.reasons).toEqual([
      "high_risk",
      "clarification_recommended",
      "material_ambiguity_requires_user",
      "confidence_below_threshold",
    ]);
    expect(latest?.assessment.outcome).toBe("review");
    expect(latest?.assessment.observedConfidence).toBe(0.1);
    expect(latest?.assessment.policyVersion).toBe("quality-policy-v1");
    const serialized = JSON.stringify(latest?.assessment);
    expect(serialized).not.toContain("dangerous");
    expect(serialized).not.toContain("needs confirmation");
    expect(serialized).not.toContain("spec missing");
  });

  it.each([
    "observe",
    "review",
  ] as const)("stays transformed and only carries the bounded assessment under %s enforcement", async (enforcement) => {
    const reviewIntent: IntentDocumentV1 = {
      ...validIntent(),
      risk: { level: "high", reasons: ["x"] },
    };
    const pipeline = new InterpretationPipeline(
      provider(reviewIntent),
      compiler(),
    );
    const result = await pipeline.run(input(), {
      ...options,
      quality: { ...DEFAULT_QUALITY_CONFIG, enforcement },
    });
    expect(result).toMatchObject({ status: "transformed" });
    const latest = pipeline.getLatest();
    expect(latest?.assessment.outcome).toBe("review");
    expect(latest?.assessment.reasons).toEqual(["high_risk"]);
  });

  it("keeps the source language when the provider changes it without an explicit response instruction", async () => {
    const providerIntent = {
      ...validIntent(),
      sourceLanguage: { code: "tr", confidence: 0.95 },
      responseLanguage: { code: "en" },
    };
    const testCompiler: HarnessCompiler<IntentDocumentV1> = {
      compile: vi.fn().mockImplementation(({ intent }) => ({
        compilerVersion: "pi-v1",
        text: `compiled task (${intent.responseLanguage.code})`,
        responseLanguageCode: intent.responseLanguage.code,
      })),
    };
    const pipeline = new InterpretationPipeline(
      provider(providerIntent),
      testCompiler,
    );

    await expect(pipeline.run(input(), options)).resolves.toMatchObject({
      status: "transformed",
      compiledTask: "compiled task (tr)",
      intent: { responseLanguage: { code: "tr" } },
    });
    expect(testCompiler.compile).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({ responseLanguage: { code: "tr" } }),
      }),
    );
  });

  it.each([
    ["Respond to the user in English", "en"],
    ["Write README in English", "tr"],
  ])("honors only explicit final-response language instructions", async (constraint, language) => {
    const providerIntent = {
      ...validIntent(),
      sourceLanguage: { code: "tr", confidence: 0.95 },
      responseLanguage: { code: "en" },
      globalConstraints: [constraint],
    };
    const testCompiler: HarnessCompiler<IntentDocumentV1> = {
      compile: vi.fn().mockImplementation(({ intent }) => ({
        compilerVersion: "pi-v1",
        text: intent.responseLanguage.code,
        responseLanguageCode: intent.responseLanguage.code,
      })),
    };

    await expect(
      new InterpretationPipeline(provider(providerIntent), testCompiler).run(
        input(),
        options,
      ),
    ).resolves.toMatchObject({ compiledTask: language });
  });

  it.each([
    [
      "Turkish default despite English README",
      "tr",
      "en",
      "source_language_default",
      "tr",
    ],
    [
      "mixed-language request defaults to source",
      "tr",
      "en",
      "source_language_default",
      "tr",
    ],
    [
      "artifact and response language differ",
      "tr",
      "en",
      "source_language_default",
      "tr",
    ],
    ["explicit English final response", "tr", "en", "user_explicit", "en"],
    ["explicit Spanish final response", "en", "es", "user_explicit", "es"],
  ] as const)("uses V2 provenance for %s", async (_, source, response, provenance, expected) => {
    const providerIntent = {
      ...validIntent(),
      schemaVersion: "2" as const,
      sourceLanguage: { code: source, confidence: 0.95 },
      responseLanguage: { code: response, source: provenance },
      globalConstraints: ["Write README in English"],
    };
    const testCompiler: HarnessCompiler<
      import("../src/index.js").IntentDocument
    > = {
      compile: vi.fn().mockImplementation(({ intent }) => ({
        compilerVersion: "pi-v1",
        text: intent.responseLanguage.code,
        responseLanguageCode: intent.responseLanguage.code,
      })),
    };
    await expect(
      new InterpretationPipeline(provider(providerIntent), testCompiler).run(
        input(),
        options,
      ),
    ).resolves.toMatchObject({ compiledTask: expected });
  });

  it("keeps an explicit follow-up response-language override", async () => {
    const providerIntent = {
      ...validIntent(),
      schemaVersion: "2" as const,
      messageType: "follow_up" as const,
      sourceLanguage: { code: "tr", confidence: 0.95 },
      responseLanguage: { code: "en", source: "user_explicit" as const },
    };
    const testCompiler: HarnessCompiler<
      import("../src/index.js").IntentDocument
    > = {
      compile: vi.fn().mockImplementation(({ intent }) => ({
        compilerVersion: "pi-v1",
        text: intent.responseLanguage.code,
        responseLanguageCode: intent.responseLanguage.code,
      })),
    };
    await expect(
      new InterpretationPipeline(provider(providerIntent), testCompiler).run(
        { ...input(), messageType: "follow_up" },
        options,
      ),
    ).resolves.toMatchObject({ compiledTask: "en" });
  });

  it("passes an empty context through unchanged", async () => {
    const testProvider = provider();
    const pipeline = new InterpretationPipeline(testProvider, compiler());
    const project = { instructionExcerpts: [] };

    await expect(pipeline.run(input(project), options)).resolves.toMatchObject({
      status: "transformed",
    });
    expect(testProvider.interpret).toHaveBeenCalledWith(
      expect.objectContaining({ projectContext: project }),
      expect.anything(),
    );
  });

  it.each([
    "PROVIDER_TIMEOUT",
    "PROVIDER_INVALID_JSON",
    "INTENT_SCHEMA_INVALID",
  ] as const)("fails open with %s exactly once and preserves the original text", async (code) => {
    const testProvider = provider();
    vi.mocked(testProvider.interpret).mockRejectedValue(
      new BridgeError({ code, safeMessage: "safe", retryable: true }),
    );
    const testCompiler = compiler();
    const pipeline = new InterpretationPipeline(testProvider, testCompiler);

    await expect(pipeline.run(input(), options)).resolves.toEqual({
      status: "fail_open",
      originalText: "Fix the profile layout.",
      errorCode: code,
      traceId: "trace-1",
    });
    expect(testProvider.interpret).toHaveBeenCalledTimes(1);
    expect(testCompiler.compile).not.toHaveBeenCalled();
  });

  it("retries a retryable provider error once with the same request", async () => {
    const testProvider = provider();
    vi.mocked(testProvider.interpret)
      .mockRejectedValueOnce(
        new BridgeError({
          code: "PROVIDER_TIMEOUT",
          safeMessage: "safe",
          retryable: true,
        }),
      )
      .mockResolvedValueOnce({
        intent: validIntent(),
        rawResponseHash: "hash",
        latencyMs: 12,
      });
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      await expect(
        new InterpretationPipeline(testProvider, compiler()).run(input(), {
          ...options,
          retryPolicy: { maxRetries: 1, baseDelayMs: 1, totalBudgetMs: 1000 },
        }),
      ).resolves.toMatchObject({ status: "transformed" });
    } finally {
      random.mockRestore();
    }
    expect(testProvider.interpret).toHaveBeenCalledTimes(2);
    expect(testProvider.interpret.mock.calls[1]?.[0]).toEqual(
      testProvider.interpret.mock.calls[0]?.[0],
    );
  });

  it("uses exponential full-jitter delays between retries", async () => {
    const testProvider = provider();
    vi.mocked(testProvider.interpret)
      .mockRejectedValueOnce(
        new BridgeError({
          code: "PROVIDER_SERVER",
          safeMessage: "safe",
          retryable: true,
        }),
      )
      .mockRejectedValueOnce(
        new BridgeError({
          code: "PROVIDER_SERVER",
          safeMessage: "safe",
          retryable: true,
        }),
      );
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const timeout = vi.spyOn(globalThis, "setTimeout");
    try {
      await new InterpretationPipeline(testProvider, compiler()).run(input(), {
        ...options,
        retryPolicy: {
          maxRetries: 2,
          baseDelayMs: 10,
          totalBudgetMs: 1000,
        },
      });
      expect(timeout.mock.calls.map((call) => call[1])).toEqual(
        expect.arrayContaining([5, 10]),
      );
    } finally {
      random.mockRestore();
      timeout.mockRestore();
    }
    expect(testProvider.interpret).toHaveBeenCalledTimes(3);
  });

  it.each([
    "PROVIDER_AUTH",
    "PROVIDER_INVALID_JSON",
    "INTENT_SCHEMA_INVALID",
    "PROVIDER_RESPONSE_TOO_LARGE",
    "TRACE_WRITE_FAILED",
  ] as const)("does not retry non-provider-transient %s errors", async (code) => {
    const testProvider = provider();
    vi.mocked(testProvider.interpret).mockRejectedValue(
      new BridgeError({ code, safeMessage: "safe", retryable: true }),
    );
    await expect(
      new InterpretationPipeline(testProvider, compiler()).run(input(), {
        ...options,
        retryPolicy: { maxRetries: 2, baseDelayMs: 1, totalBudgetMs: 1000 },
      }),
    ).resolves.toMatchObject({ status: "fail_open", errorCode: code });
    expect(testProvider.interpret).toHaveBeenCalledTimes(1);
  });

  it("fails open with the last provider error on retry exhaustion and settles caller abort", async () => {
    const exhausted = provider();
    vi.mocked(exhausted.interpret).mockRejectedValue(
      new BridgeError({
        code: "PROVIDER_TIMEOUT",
        safeMessage: "safe",
        retryable: true,
      }),
    );
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      await expect(
        new InterpretationPipeline(exhausted, compiler()).run(input(), {
          ...options,
          retryPolicy: { maxRetries: 2, baseDelayMs: 1, totalBudgetMs: 1000 },
        }),
      ).resolves.toMatchObject({
        status: "fail_open",
        errorCode: "PROVIDER_TIMEOUT",
        originalText: "Fix the profile layout.",
      });
    } finally {
      random.mockRestore();
    }
    expect(exhausted.interpret).toHaveBeenCalledTimes(3);

    const controller = new AbortController();
    const aborted = provider();
    vi.mocked(aborted.interpret).mockImplementation(
      (_request, callOptions) =>
        new Promise((_, reject) => {
          callOptions.signal?.addEventListener(
            "abort",
            () =>
              reject(
                new BridgeError({
                  code: "PROVIDER_TIMEOUT",
                  safeMessage: "safe",
                  retryable: true,
                }),
              ),
            { once: true },
          );
          setTimeout(() => controller.abort(), 0);
        }),
    );
    await expect(
      new InterpretationPipeline(aborted, compiler()).run(input(), {
        ...options,
        signal: controller.signal,
        retryPolicy: { maxRetries: 2, baseDelayMs: 100, totalBudgetMs: 1000 },
      }),
    ).resolves.toMatchObject({
      status: "fail_open",
      errorCode: "PROVIDER_UNREACHABLE",
      originalText: "Fix the profile layout.",
    });
    expect(aborted.interpret).toHaveBeenCalledTimes(1);
  });

  it("settles a deadline abort before an abort-listener provider can resolve", async () => {
    vi.useFakeTimers();
    const interpret = vi.fn(
      (_request: unknown, callOptions: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          callOptions.signal?.addEventListener(
            "abort",
            () =>
              queueMicrotask(() =>
                resolve({
                  intent: validIntent(),
                  rawResponseHash: "hash",
                  latencyMs: 1,
                }),
              ),
            { once: true },
          );
        }),
    );
    try {
      const result = new InterpretationPipeline(
        { id: "abort-listener", interpret, testConnection: vi.fn() },
        compiler(),
      ).run(input(), {
        ...options,
        retryPolicy: { maxRetries: 1, baseDelayMs: 1, totalBudgetMs: 1 },
      });
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual({
        status: "fail_open",
        originalText: "Fix the profile layout.",
        errorCode: "PROVIDER_TIMEOUT",
        traceId: "trace-1",
      });
      expect(interpret).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles caller abort during provider invocation when the provider ignores its signal", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const interpret = vi.fn(() => {
      controller.abort();
      return new Promise<never>(() => undefined);
    });
    try {
      const result = new InterpretationPipeline(
        { id: "caller-abort", interpret, testConnection: vi.fn() },
        compiler(),
      ).run(input(), {
        ...options,
        signal: controller.signal,
        retryPolicy: { maxRetries: 1, baseDelayMs: 1, totalBudgetMs: 1000 },
      });
      let settled: Awaited<typeof result> | undefined;
      void result.then((value) => {
        settled = value;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toEqual({
        status: "fail_open",
        originalText: "Fix the profile layout.",
        errorCode: "PROVIDER_UNREACHABLE",
        traceId: "trace-1",
      });
      expect(interpret).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails open after the total retry budget without another call", async () => {
    const testProvider = provider();
    vi.mocked(testProvider.interpret).mockImplementation(
      () => new Promise(() => undefined),
    );
    await expect(
      new InterpretationPipeline(testProvider, compiler()).run(input(), {
        ...options,
        retryPolicy: { maxRetries: 2, baseDelayMs: 1, totalBudgetMs: 1 },
      }),
    ).resolves.toMatchObject({
      status: "fail_open",
      errorCode: "PROVIDER_TIMEOUT",
      originalText: "Fix the profile layout.",
    });
    expect(testProvider.interpret).toHaveBeenCalledTimes(1);
  });

  it("rejects leaked no-code constraint when source does not request it", async () => {
    const leakedIntent: IntentDocumentV1 = {
      ...validIntent(),
      globalConstraints: [
        "No implementation code to be written in this response",
      ],
    };
    const testCompiler = compiler();
    const pipeline = new InterpretationPipeline(
      provider(leakedIntent),
      testCompiler,
    );

    await expect(pipeline.run(input(), options)).resolves.toEqual({
      status: "fail_open",
      originalText: "Fix the profile layout.",
      errorCode: "INTENT_SCHEMA_INVALID",
      traceId: "trace-1",
    });
    expect(testCompiler.compile).not.toHaveBeenCalled();
  });

  it("allows leaked no-code constraint when user explicitly requests no code in English", async () => {
    const leakedIntent: IntentDocumentV1 = {
      ...validIntent(),
      globalConstraints: ["Do not write implementation code"],
    };
    const testCompiler = compiler();
    const pipeline = new InterpretationPipeline(
      provider(leakedIntent),
      testCompiler,
    );

    const enInput: BridgeInput = {
      ...input(),
      originalText: "Explain how this works, no code needed.",
    };
    await expect(pipeline.run(enInput, options)).resolves.toMatchObject({
      status: "transformed",
    });
    expect(testCompiler.compile).toHaveBeenCalledTimes(1);
  });

  it("allows leaked no-code constraint when user explicitly requests no code in Turkish", async () => {
    const leakedIntent: IntentDocumentV1 = {
      ...validIntent(),
      globalConstraints: ["Do not write implementation code"],
    };
    const testCompiler = compiler();
    const pipeline = new InterpretationPipeline(
      provider(leakedIntent),
      testCompiler,
    );

    const trInput: BridgeInput = {
      ...input(),
      originalText: "Sadece açıklama yap, kod yazma.",
    };
    await expect(pipeline.run(trInput, options)).resolves.toMatchObject({
      status: "transformed",
    });
    expect(testCompiler.compile).toHaveBeenCalledTimes(1);
  });

  it("checks task constraints for leaked no-code too", async () => {
    const leakedIntent: IntentDocumentV1 = {
      ...validIntent(),
      tasks: [
        {
          ...(validIntent().tasks[0] as IntentDocumentV1["tasks"][number]),
          constraints: ["Do not write implementation code"],
        },
      ],
    };
    const testCompiler = compiler();
    const pipeline = new InterpretationPipeline(
      provider(leakedIntent),
      testCompiler,
    );

    await expect(pipeline.run(input(), options)).resolves.toEqual({
      status: "fail_open",
      originalText: "Fix the profile layout.",
      errorCode: "INTENT_SCHEMA_INVALID",
      traceId: "trace-1",
    });
    expect(testCompiler.compile).not.toHaveBeenCalled();
  });

  it("defensively rejects an invalid provider intent without compiling or retrying", async () => {
    const testProvider = provider({
      invalid: true,
    } as unknown as IntentDocumentV1);
    const testCompiler = compiler();
    const pipeline = new InterpretationPipeline(testProvider, testCompiler);

    await expect(pipeline.run(input(), options)).resolves.toMatchObject({
      status: "fail_open",
      errorCode: "INTENT_SCHEMA_INVALID",
    });
    expect(testProvider.interpret).toHaveBeenCalledTimes(1);
    expect(testCompiler.compile).not.toHaveBeenCalled();
  });

  it("maps unknown provider failures safely without leaking their message", async () => {
    const testProvider = provider();
    const traceSink: TraceSink = {
      append: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(testProvider.interpret).mockRejectedValue(
      new Error("provider secret"),
    );
    const pipeline = new InterpretationPipeline(
      testProvider,
      compiler(),
      traceSink,
    );

    await expect(pipeline.run(input(), options)).resolves.toMatchObject({
      status: "fail_open",
      errorCode: "PROVIDER_UNREACHABLE",
    });
    expect(
      JSON.stringify(vi.mocked(traceSink.append).mock.calls),
    ).not.toContain("provider secret");
  });

  it("maps compiler throws to COMPILER_FAILED and leaves the latest success untouched", async () => {
    const testCompiler = compiler();
    vi.mocked(testCompiler.compile).mockImplementation(() => {
      throw new Error("compiler details");
    });
    const testProvider = provider();
    const pipeline = new InterpretationPipeline(testProvider, testCompiler);

    await expect(pipeline.run(input(), options)).resolves.toMatchObject({
      status: "fail_open",
      errorCode: "COMPILER_FAILED",
    });
    expect(testProvider.interpret).toHaveBeenCalledTimes(1);
    expect(pipeline.getLatest()).toBeUndefined();
  });

  it("does not let trace failures alter transformed or fail-open results", async () => {
    const rejectedSink: TraceSink = {
      append: vi.fn().mockRejectedValue(new Error("disk failure")),
    };
    const successful = new InterpretationPipeline(
      provider(),
      compiler(),
      rejectedSink,
    );
    await expect(successful.run(input(), options)).resolves.toMatchObject({
      status: "transformed",
    });

    const failedProvider = provider();
    vi.mocked(failedProvider.interpret).mockRejectedValue(
      new BridgeError({
        code: "PROVIDER_TIMEOUT",
        safeMessage: "safe",
        retryable: true,
      }),
    );
    const failed = new InterpretationPipeline(
      failedProvider,
      compiler(),
      rejectedSink,
    );
    await expect(failed.run(input(), options)).resolves.toMatchObject({
      status: "fail_open",
      errorCode: "PROVIDER_TIMEOUT",
    });
    expect(rejectedSink.append).toHaveBeenCalledTimes(2);
  });

  it("updates latest only after a successful compilation", async () => {
    const testProvider = provider();
    const testCompiler = compiler();
    const pipeline = new InterpretationPipeline(testProvider, testCompiler);
    await pipeline.run(input(), options);
    const latest = pipeline.getLatest();
    vi.mocked(testCompiler.compile).mockImplementation(() => {
      throw new Error("next compile failed");
    });

    await expect(
      pipeline.run({ ...input(), traceId: "trace-2" }, options),
    ).resolves.toMatchObject({
      status: "fail_open",
      errorCode: "COMPILER_FAILED",
    });
    expect(pipeline.getLatest()).toBe(latest);
  });

  it("retains the full latest transformation regardless of logging mode", async () => {
    for (const mode of ["metadata", "off"] as const) {
      const pipeline = new InterpretationPipeline(provider(), compiler());
      await pipeline.run(input(), {
        ...options,
        logging: { mode, retentionDays: 30 },
      });
      expect(pipeline.getLatest()).toMatchObject({
        originalText: "Fix the profile layout.",
        intent: validIntent(),
        compiledTask: { text: "compiled task" },
      });
    }
  });
});

describe("quality and pricing", () => {
  it("returns only structural quality signals, including compiler false", () => {
    expect(
      calculateQualitySignals(validIntent(), { compilerValid: false }),
    ).toEqual({
      schemaValid: true,
      languagePresent: true,
      taskCount: 1,
      hasGoal: true,
      constraintsSeparated: true,
      assumptionsSeparated: true,
      ambiguitiesTyped: true,
      compilerValid: false,
      providerConfidence: 0.9,
    });
  });

  it("calculates configured token cost and omits incomplete pricing or usage", () => {
    expect(
      estimateCostUsd(
        { inputTokens: 1_000_000, outputTokens: 2_000_000 },
        { inputPerMillion: 1.5, outputPerMillion: 2 },
      ),
    ).toBe(5.5);
    expect(estimateCostUsd(undefined, { inputPerMillion: 1 })).toBeUndefined();
    expect(
      estimateCostUsd({ inputTokens: 1 }, { outputPerMillion: 1 }),
    ).toBeUndefined();
  });
});
