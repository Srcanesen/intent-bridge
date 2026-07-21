import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BridgeError,
  loadLayeredConfig,
  type BridgeConfigV1,
  type IntentProvider,
} from "@intent-bridge/core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { createIntentBridgeExtension } from "../src/index.js";
import type { PiModelRegistry } from "../src/pi-model-provider.js";

const config = (patch: Partial<BridgeConfigV1> = {}): BridgeConfigV1 => ({
  version: 1,
  enabled: true,
  mode: "auto",
  activeProfile: "local",
  profiles: {
    local: {
      id: "local",
      protocol: "openai-compatible",
      baseUrl: "http://localhost",
      model: "bridge-model",
      apiKeyEnv: "SENTINEL_SECRET",
      timeoutMs: 1000,
      maxOutputTokens: 1000,
      capabilities: {
        structuredOutput: "json_object",
        usageMetadata: false,
        supportsSeed: false,
      },
    },
  },
  context: { enabled: true, maxCharacters: 100, maxFileCharacters: 100 },
  logging: { mode: "metadata", retentionDays: 7 },
  quality: {
    enforcement: "observe",
    reviewOnHighRisk: true,
    reviewOnClarification: true,
    reviewOnMaterialAskUser: true,
    minConfidence: null,
    noUiAction: "send_original",
  },
  retry: { maxRetries: 1, baseDelayMs: 250, totalBudgetMs: 45000 },
  ...patch,
});

const intent = (messageType = "initial") => ({
  schemaVersion: "1" as const,
  sourceLanguage: { code: "tr", confidence: 0.95 },
  responseLanguage: { code: "tr" },
  messageType,
  goal: "Fix the profile page",
  tasks: [
    {
      id: "profile",
      objective: "Fix the profile page",
      scope: [],
      constraints: [],
      successCriteria: [],
    },
  ],
  globalConstraints: [],
  assumptions: [],
  ambiguities: [],
  risk: { level: "low" as const, reasons: [] },
  confidence: 0.9,
  clarification: { recommended: false },
});

const reviewIntent = (messageType = "initial") => ({
  ...intent(messageType),
  risk: { level: "high" as const, reasons: ["x"] },
});

let setupSequence = 0;

function setup(
  options: {
    config?: BridgeConfigV1;
    provider?: IntentProvider;
    history?: unknown[];
    trusted?: boolean;
    loadConfig?: () => Promise<BridgeConfigV1>;
    collectContext?: () => Promise<{
      context: { name: string; instructionExcerpts: string[] };
      manifest: { entries: unknown[] };
    }>;
    createProvider?: () => IntentProvider;
    createPiProvider?: () => IntentProvider;
    updateConfig?: ReturnType<typeof vi.fn>;
    environment?: NodeJS.ProcessEnv;
    select?: (title: string, choices: string[]) => Promise<string | undefined>;
    input?: (title: string, value?: string) => Promise<string | undefined>;
    uuid?: () => string;
    now?: () => Date;
    modelRegistry?: PiModelRegistry;
  } = {},
) {
  const handlers: Record<string, (event: any, ctx: any) => Promise<any>> = {};
  let command: ((args: string, ctx: any) => Promise<void>) | undefined;
  let commandOptions:
    | Parameters<ExtensionAPI["registerCommand"]>[1]
    | undefined;
  const pi = {
    on: vi.fn((name, handler) => {
      handlers[name] = handler;
    }),
    registerCommand: vi.fn((_name, value) => {
      command = value.handler;
      commandOptions = value;
    }),
    appendEntry: vi.fn(),
  } as unknown as ExtensionAPI;
  const notices: string[] = [];
  const noticeLevels: string[] = [];
  const ctx = {
    cwd: "/tmp/project",
    hasUI: true,
    signal: undefined,
    ui: {
      notify: (message: string, level?: string) => {
        notices.push(message);
        noticeLevels.push(level ?? "info");
      },
      select: options.select ?? (async () => undefined),
      input: options.input ?? (async () => undefined),
    },
    isProjectTrusted: () => options.trusted ?? true,
    sessionManager: {
      getBranch: () => options.history ?? [],
      getSessionId: () => "session-1",
    },
    modelRegistry: options.modelRegistry ?? {
      refresh: vi.fn().mockResolvedValue(undefined),
      getAvailable: vi.fn(() => []),
      find: vi.fn(() => undefined),
      isUsingOAuth: vi.fn(() => false),
      getApiKeyAndHeaders: vi.fn(),
    },
  };
  const provider = options.provider ?? {
    id: "local",
    interpret: vi.fn().mockImplementation(async (request) => ({
      intent: intent(request.messageType),
      rawResponseHash: "hash",
      latencyMs: 1,
    })),
    testConnection: vi.fn(),
  };
  const createProvider = vi.fn(options.createProvider ?? (() => provider));
  const collectContext = vi.fn(
    options.collectContext ??
      (async () => ({
        context: { name: "project", instructionExcerpts: [] },
        manifest: { entries: [] },
      })),
  );
  const trace = {
    append: vi.fn().mockResolvedValue(undefined),
    prune: vi.fn().mockResolvedValue(undefined),
  };
  const createTraceWriter = vi.fn(() => trace);
  createIntentBridgeExtension(pi, {
    environment: options.environment ?? {
      INTENT_BRIDGE_HOME: join(
        tmpdir(),
        `intent-bridge-extension-test-${process.pid}-${setupSequence++}`,
      ),
      SENTINEL_SECRET: "do-not-print",
    },
    uuid: options.uuid ?? (() => "trace-1"),
    now: options.now ?? (() => new Date("2026-07-19T12:00:00.000Z")),
    loadConfig: options.loadConfig ?? (async () => options.config ?? config()),
    collectContext: collectContext as never,
    createProvider,
    createPiProvider: options.createPiProvider ?? (() => provider),
    createTraceWriter: createTraceWriter as never,
    updateConfig: options.updateConfig as never,
  });
  return {
    handlers,
    command: () => command!,
    commandOptions: () => commandOptions,
    ctx,
    notices,
    noticeLevels,
    provider,
    createProvider,
    collectContext,
    trace,
    createTraceWriter,
    pi,
  };
}

const input = (patch: Record<string, unknown> = {}) => ({
  text: "Profil sayfasını düzelt",
  source: "interactive",
  ...patch,
});

describe("Intent Bridge Pi extension", () => {
  it("offers discoverable bridge subcommand completions", async () => {
    const complete = setup().commandOptions()?.getArgumentCompletions;
    expect(complete).toBeTypeOf("function");
    if (!complete) throw new Error("bridge completions are missing");
    expect(await complete("")).toContainEqual({
      value: "status",
      label: "status",
    });
    expect(await complete("")).toContainEqual({
      value: "model",
      label: "model",
    });
    expect(await complete("preview ")).toContainEqual({
      value: "preview off",
      label: "preview off",
    });
    expect(await complete("")).not.toContainEqual({
      value: "provider",
      label: "provider",
    });
    expect(await complete("rate ")).toEqual([
      { value: "rate good", label: "rate good" },
      { value: "rate bad", label: "rate bad" },
    ]);
    expect(await complete("unknown")).toBeNull();
  });

  it("opens all compatible Pi models from an empty setup and validates the picked model once", async () => {
    const home = await mkdtemp(join(tmpdir(), "bridge-"));
    const models = [
      {
        id: "model-a",
        name: "Alpha",
        api: "openai-completions",
        input: ["text"],
        contextWindow: 1000,
        provider: "one",
        baseUrl: "https://one.example/v1",
        maxTokens: 1000,
        cost: { input: 1, output: 1 },
      },
      {
        id: "model-b",
        name: "Beta",
        api: "openai-completions",
        input: ["text"],
        contextWindow: 1000,
        provider: "two",
        baseUrl: "https://two.example/v1",
        maxTokens: 1000,
        cost: { input: 1, output: 1 },
      },
    ];
    const registry = {
      refresh: vi.fn().mockResolvedValue(undefined),
      getAvailable: vi.fn(() => models),
      find: vi.fn((provider, id) =>
        models.find((model) => model.provider === provider && model.id === id),
      ),
      isUsingOAuth: vi.fn(() => false),
      getApiKeyAndHeaders: vi
        .fn()
        .mockResolvedValue({ ok: true, apiKey: "key" }),
    };
    const provider = {
      id: "pi",
      interpret: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
    } as unknown as IntentProvider;
    const test = setup({
      config: config({ activeProfile: "", profiles: {} }),
      environment: { INTENT_BRIDGE_HOME: home },
      modelRegistry: registry,
      provider,
      select: async (title, choices) => {
        expect(title).toBe("Select Intent Bridge model");
        expect(choices).toEqual([
          "Alpha — model-a (one)",
          "Beta — model-b (two)",
        ]);
        return "Beta — model-b (two)";
      },
    });
    await test.command()("model", test.ctx);
    expect(registry.refresh).toHaveBeenCalledTimes(1);
    expect(provider.testConnection).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(await readFile(join(home, "pi-model-selection.json"), "utf8")),
    ).toEqual({ version: 1, provider: "two", model: "model-b" });
    expect(test.notices.at(-1)).toBe("Intent Bridge is ready with Beta.");
  });

  it("keeps the old selection on one failed direct validation and ignores ambiguous IDs", async () => {
    const home = await mkdtemp(join(tmpdir(), "bridge-"));
    await writeFile(
      join(home, "pi-model-selection.json"),
      JSON.stringify({ version: 1, provider: "old", model: "old-model" }),
    );
    const models = ["one", "two"].map((provider) => ({
      id: "shared",
      name: provider,
      api: "openai-completions",
      input: ["text"],
      contextWindow: 1000,
      provider,
      baseUrl: `https://${provider}.example/v1`,
      maxTokens: 1000,
      cost: { input: 1, output: 1 },
    }));
    const registry = {
      refresh: vi.fn().mockResolvedValue(undefined),
      getAvailable: vi.fn(() => models),
      find: vi.fn((provider, id) =>
        models.find((model) => model.provider === provider && model.id === id),
      ),
      isUsingOAuth: vi.fn(() => false),
      getApiKeyAndHeaders: vi
        .fn()
        .mockResolvedValue({ ok: true, apiKey: "key" }),
    };
    const provider = {
      id: "pi",
      interpret: vi.fn(),
      testConnection: vi.fn().mockRejectedValue(
        new BridgeError({
          code: "PROVIDER_AUTH",
          safeMessage: "raw provider detail",
          retryable: false,
        }),
      ),
    } as unknown as IntentProvider;
    const test = setup({
      config: config({ activeProfile: "", profiles: {} }),
      environment: { INTENT_BRIDGE_HOME: home },
      modelRegistry: registry,
      provider,
    });
    await test.command()("model one/shared", test.ctx);
    expect(provider.testConnection).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(await readFile(join(home, "pi-model-selection.json"), "utf8")),
    ).toEqual({ version: 1, provider: "old", model: "old-model" });
    expect(test.notices.at(-1)).toBe(
      "Intent Bridge could not use that model. The previous selection was kept. Try /bridge model again.",
    );
    expect(test.notices.at(-1)).not.toContain("PROVIDER_AUTH");
    expect(test.notices.at(-1)).not.toContain("raw provider detail");
    await test.command()("model shared", test.ctx);
    expect(provider.testConnection).toHaveBeenCalledTimes(1);
    expect(registry.getApiKeyAndHeaders).not.toHaveBeenCalled();
  });

  it("opens the model picker when /bridge on has no usable model", async () => {
    const home = await mkdtemp(join(tmpdir(), "bridge-"));
    const updates = vi.fn().mockResolvedValue(undefined);
    const model = {
      id: "model-a",
      name: "Alpha",
      api: "openai-completions",
      input: ["text"],
      contextWindow: 1000,
      provider: "one",
      baseUrl: "https://one.example/v1",
      maxTokens: 1000,
      cost: { input: 1, output: 1 },
    };
    const registry = {
      refresh: vi.fn().mockResolvedValue(undefined),
      getAvailable: vi.fn(() => [model]),
      find: vi.fn(() => model),
      isUsingOAuth: vi.fn(() => false),
      getApiKeyAndHeaders: vi.fn(),
    };
    const provider = {
      id: "pi",
      interpret: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
    } as unknown as IntentProvider;
    const select = vi.fn(async () => "Alpha — model-a (one)");
    const test = setup({
      config: config({ activeProfile: "", profiles: {} }),
      environment: { INTENT_BRIDGE_HOME: home },
      modelRegistry: registry,
      provider,
      select,
      updateConfig: updates,
    });
    await test.command()("on", test.ctx);
    expect(updates).toHaveBeenCalledWith(expect.anything(), undefined, {
      enabled: true,
      mode: "auto",
    });
    expect(select).toHaveBeenCalledTimes(1);
    expect(provider.testConnection).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(await readFile(join(home, "pi-model-selection.json"), "utf8")),
    ).toEqual({ version: 1, provider: "one", model: "model-a" });
    expect(test.notices.at(-1)).toBe("Intent Bridge is ready with Alpha.");
  });

  it("keeps a usable selected model when /bridge on is repeated", async () => {
    const home = await mkdtemp(join(tmpdir(), "bridge-"));
    await writeFile(
      join(home, "pi-model-selection.json"),
      JSON.stringify({ version: 1, provider: "one", model: "model-a" }),
    );
    const updates = vi.fn().mockResolvedValue(undefined);
    const model = {
      id: "model-a",
      name: "Alpha",
      api: "openai-completions",
      input: ["text"],
      contextWindow: 1000,
      provider: "one",
      baseUrl: "https://one.example/v1",
      maxTokens: 1000,
      cost: { input: 1, output: 1 },
    };
    const select = vi.fn();
    const test = setup({
      config: config({ activeProfile: "", profiles: {} }),
      environment: { INTENT_BRIDGE_HOME: home },
      modelRegistry: {
        refresh: vi.fn().mockResolvedValue(undefined),
        getAvailable: vi.fn(() => [model]),
        find: vi.fn(() => model),
        isUsingOAuth: vi.fn(() => false),
        getApiKeyAndHeaders: vi.fn(),
      },
      select,
      updateConfig: updates,
    });
    await test.command()("on", test.ctx);
    expect(select).not.toHaveBeenCalled();
    expect(test.notices.at(-1)).toBe("Intent Bridge enabled.");
  });

  it("does not enable Bridge when /bridge on cannot select a model", async () => {
    const updates = vi.fn().mockResolvedValue(undefined);
    const test = setup({
      config: config({ activeProfile: "", profiles: {} }),
      updateConfig: updates,
    });
    await test.command()("on", test.ctx);
    expect(updates).not.toHaveBeenCalled();
    expect(test.notices.at(-1)).toBe("No compatible Pi models are available.");
  });

  it("transforms interactive initial input with one provider call", async () => {
    const test = setup();
    await expect(test.handlers.input(input(), test.ctx)).resolves.toEqual({
      action: "continue",
    });
    expect(test.provider.interpret).toHaveBeenCalledTimes(1);
    expect(test.provider.interpret).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: "initial" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("passes resolved production retry policy to the pipeline", async () => {
    const provider = {
      id: "local",
      interpret: vi
        .fn()
        .mockRejectedValueOnce(
          new BridgeError({
            code: "PROVIDER_TIMEOUT",
            safeMessage: "safe",
            retryable: true,
          }),
        )
        .mockResolvedValueOnce({
          intent: intent(),
          rawResponseHash: "hash",
          latencyMs: 1,
        }),
      testConnection: vi.fn(),
    } as unknown as IntentProvider;
    const test = setup({
      provider,
      config: config({
        retry: { maxRetries: 1, baseDelayMs: 1, totalBudgetMs: 1000 },
      }),
    });
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      await test.handlers.input(input(), test.ctx);
    } finally {
      random.mockRestore();
    }
    expect(provider.interpret).toHaveBeenCalledTimes(2);
  });

  it("bypasses exact standalone small talk before configuration or provider work", async () => {
    const test = setup();
    await expect(
      test.handlers.input(input({ text: " Selam! " }), test.ctx),
    ).resolves.toEqual({
      action: "continue",
    });
    expect(test.provider.interpret).not.toHaveBeenCalled();
    expect(test.createProvider).not.toHaveBeenCalled();
    expect(test.collectContext).not.toHaveBeenCalled();
  });

  it("maps normal, steer, follow_up, and rpc input", async () => {
    const normal = setup({
      history: [{ type: "message", message: { role: "user" } }],
    });
    await normal.handlers.input(input(), normal.ctx);
    expect(normal.provider.interpret).toHaveBeenLastCalledWith(
      expect.objectContaining({ messageType: "normal" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    for (const [streamingBehavior, expected] of [
      ["steer", "steer"],
      ["followUp", "follow_up"],
    ] as const) {
      const test = setup();
      const result = await test.handlers.input(
        input({ streamingBehavior }),
        test.ctx,
      );
      expect(result.action).toBe("continue");
      expect(test.provider.interpret).toHaveBeenCalledWith(
        expect.objectContaining({ messageType: expected }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    }
    const rpc = setup();
    await rpc.handlers.input(input({ source: "rpc" }), rpc.ctx);
    expect(rpc.provider.interpret).toHaveBeenCalledTimes(1);
  });

  it("preserves the exact image array while sending only its count", async () => {
    const test = setup();
    const images = [
      { type: "image", data: "base64-never-provider", mimeType: "image/png" },
    ];
    const event = input({ images });
    await test.handlers.input(event, test.ctx);
    expect(event.images).toBe(images);
    expect(test.provider.interpret).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentSummary: { imageCount: 1 } }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(JSON.stringify(test.provider.interpret.mock.calls)).not.toContain(
      "base64-never-provider",
    );
  });

  it.each([
    input({ source: "extension" }),
    input({ text: "/help" }),
    input({ text: "!pwd" }),
    input({ text: "  " }),
    input({ text: "", images: [{}] }),
  ])("bypasses syntax/source/image-only input without provider work", async (event) => {
    const test = setup();
    await expect(test.handlers.input(event, test.ctx)).resolves.toEqual({
      action: "continue",
    });
    expect(test.createProvider).not.toHaveBeenCalled();
  });

  it.each([
    config({ enabled: false }),
    config({ mode: "off" }),
  ])("bypasses disabled mode", async (current) => {
    const test = setup({ config: current });
    await expect(test.handlers.input(input(), test.ctx)).resolves.toEqual({
      action: "continue",
    });
    expect(test.createProvider).not.toHaveBeenCalled();
  });

  it("delivers a successful compiled task as one hidden user-context message", async () => {
    const test = setup();
    await expect(test.handlers.input(input(), test.ctx)).resolves.toEqual({
      action: "continue",
    });
    expect(
      test.handlers.before_agent_start(
        { prompt: "Profil sayfasını düzelt" },
        test.ctx,
      ),
    ).toMatchObject({
      message: {
        customType: "intent-bridge.task",
        content: expect.stringContaining("[INTENT BRIDGE TASK"),
        display: false,
      },
    });
    expect(
      test.handlers.before_agent_start(
        { prompt: "Profil sayfasını düzelt" },
        test.ctx,
      ),
    ).toBeUndefined();
  });

  it("matches pending tasks without consuming mismatches and preserves queue order", async () => {
    const test = setup();
    await test.handlers.input(input({ text: "request A" }), test.ctx);
    await test.handlers.input(input({ text: "request B" }), test.ctx);
    expect(
      test.handlers.before_agent_start({ prompt: "other" }, test.ctx),
    ).toBeUndefined();
    expect(
      test.handlers.before_agent_start({ prompt: "request A" }, test.ctx),
    ).toMatchObject({ message: { display: false } });
    expect(
      test.handlers.before_agent_start({ prompt: "request B" }, test.ctx),
    ).toMatchObject({ message: { display: false } });
  });

  it("preserves duplicate arrival order when B completes before A", async () => {
    let releaseFirst: ((value: BridgeConfigV1) => void) | undefined;
    const firstConfig = new Promise<BridgeConfigV1>((resolve) => {
      releaseFirst = resolve;
    });
    let configCalls = 0;
    let providerCalls = 0;
    const providerFor = (label: string): IntentProvider => ({
      id: label,
      interpret: vi.fn().mockImplementation(async (request) => {
        const occurrence = intent(request.messageType);
        occurrence.goal = `${label} occurrence`;
        return { intent: occurrence, rawResponseHash: label, latencyMs: 1 };
      }),
      testConnection: vi.fn(),
    });
    const test = setup({
      loadConfig: () =>
        ++configCalls === 1 ? firstConfig : Promise.resolve(config()),
      createProvider: () => providerFor(++providerCalls === 1 ? "B" : "A"),
    });
    const first = test.handlers.input(input({ text: "same" }), test.ctx);
    await test.handlers.input(input({ text: "same" }), test.ctx);
    releaseFirst?.(config());
    await first;

    expect(
      test.handlers.before_agent_start({ prompt: "same" }, test.ctx),
    ).toMatchObject({
      message: { content: expect.stringContaining("A occurrence") },
    });
    expect(
      test.handlers.before_agent_start({ prompt: "same" }, test.ctx),
    ).toMatchObject({
      message: { content: expect.stringContaining("B occurrence") },
    });
  });

  it("correlates pending tasks with image count at reserve and consume", async () => {
    const test = setup();
    await test.handlers.input(input({ images: [{}] }), test.ctx);
    expect(
      test.handlers.before_agent_start(
        { prompt: "Profil sayfasını düzelt" },
        test.ctx,
      ),
    ).toBeUndefined();
    expect(
      test.handlers.before_agent_start(
        { prompt: "Profil sayfasını düzelt", images: [{}] },
        test.ctx,
      ),
    ).toMatchObject({ message: { display: false } });
  });

  it("previews a transformed task once with a bounded redacted summary and exact images", async () => {
    const images = [{}];
    const test = setup({
      config: config({ mode: "preview" }),
      select: async (title) => {
        expect(title).toContain("## Source language");
        expect(title).toContain("## Interpreted goal");
        expect(title).toContain("## Tasks");
        expect(title).toContain("## Global constraints");
        expect(title).toContain("## Assumptions");
        expect(title).toContain("## Ambiguities");
        expect(title).toContain("## English compiled task");
        expect(title.length).toBeLessThanOrEqual(5000);
        return "Send transformed";
      },
    });
    const result = await test.handlers.input(input({ images }), test.ctx);
    expect(result).toEqual({ action: "continue" });
    expect(test.provider.interpret).toHaveBeenCalledTimes(1);
    expect(test.trace.append).toHaveBeenCalledTimes(1);
    expect(test.trace.append.mock.calls[0][0]).toMatchObject({
      status: "success",
    });
    expect(test.pi.appendEntry).toHaveBeenCalledWith(
      "intent-bridge.preview",
      expect.objectContaining({ action: "transform" }),
    );
    expect(
      test.handlers.before_agent_start(
        { prompt: "Profil sayfasını düzelt", images },
        test.ctx,
      ),
    ).toMatchObject({
      message: { content: expect.any(String), display: false },
    });
  });

  it("sends original or handles cancelled preview with one bypass trace", async () => {
    for (const choice of ["Send original", "Cancel", undefined]) {
      const test = setup({
        config: config({ mode: "preview" }),
        select: async () => choice,
      });
      const result = await test.handlers.input(input(), test.ctx);
      expect(result.action).toBe(
        choice === "Send original" ? "continue" : "handled",
      );
      expect(test.provider.interpret).toHaveBeenCalledTimes(1);
      expect(test.trace.append).toHaveBeenCalledTimes(1);
      expect(test.trace.append.mock.calls[0][0]).toMatchObject({
        status: "bypass",
      });
      expect(
        test.handlers.before_agent_start(
          { prompt: "Profil sayfasını düzelt" },
          test.ctx,
        ),
      ).toBeUndefined();
    }
  });

  it("keeps a skipped send-original duplicate ahead of a ready duplicate", async () => {
    let selections = 0;
    const test = setup({
      config: config({ mode: "preview" }),
      select: async () =>
        ++selections === 1 ? "Send original" : "Send transformed",
    });
    await test.handlers.input(input({ text: "same" }), test.ctx);
    await test.handlers.input(input({ text: "same" }), test.ctx);

    expect(
      test.handlers.before_agent_start({ prompt: "same" }, test.ctx),
    ).toBeUndefined();
    expect(
      test.handlers.before_agent_start({ prompt: "same" }, test.ctx),
    ).toMatchObject({ message: { display: false } });
  });

  it("cancels a handled preview without creating duplicate skip debt", async () => {
    const current = config({ mode: "preview" });
    const test = setup({
      config: current,
      select: async () => "Cancel",
    });
    await expect(
      test.handlers.input(input({ text: "same" }), test.ctx),
    ).resolves.toEqual({ action: "handled" });
    current.mode = "auto";
    await test.handlers.input(input({ text: "same" }), test.ctx);

    expect(
      test.handlers.before_agent_start({ prompt: "same" }, test.ctx),
    ).toMatchObject({ message: { display: false } });
  });

  it("constructs one trace writer and reuses it for input, preview, ratings, and pruning", async () => {
    const current = config();
    const test = setup({
      config: current,
      loadConfig: async () => current,
      select: async () => "Send original",
    });
    expect(test.createTraceWriter).toHaveBeenCalledTimes(1);
    await test.handlers.input(input(), test.ctx);
    current.mode = "preview";
    await test.handlers.input(input(), test.ctx);
    await test.command()("rate good", test.ctx);
    await test.handlers.session_start({}, test.ctx);
    expect(test.createTraceWriter).toHaveBeenCalledTimes(1);
    expect(test.trace.append).toHaveBeenCalledTimes(3);
    expect(test.trace.prune).toHaveBeenCalledTimes(1);
  });

  it("bypasses preview without UI before context or provider work", async () => {
    const test = setup({ config: config({ mode: "preview" }) });
    test.ctx.hasUI = false;
    await expect(test.handlers.input(input(), test.ctx)).resolves.toEqual({
      action: "continue",
    });
    expect(test.collectContext).not.toHaveBeenCalled();
    expect(test.createProvider).not.toHaveBeenCalled();
    expect(test.trace.append).toHaveBeenCalledWith(
      expect.objectContaining({ bypassReason: "preview_ui_unavailable" }),
      expect.anything(),
    );
  });

  it("fails open if preview selection fails without leaking an exception", async () => {
    const test = setup({
      config: config({ mode: "preview" }),
      select: async () => {
        throw new Error("SENTINEL_SECRET");
      },
    });
    await expect(test.handlers.input(input(), test.ctx)).resolves.toEqual({
      action: "continue",
    });
    expect(test.trace.append).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "bypass",
        bypassReason: "preview_ui_failed",
      }),
      expect.anything(),
    );
    expect(test.notices.join(" ")).not.toContain("SENTINEL_SECRET");
    expect(
      test.handlers.before_agent_start(
        { prompt: "Profil sayfasını düzelt" },
        test.ctx,
      ),
    ).toBeUndefined();
  });

  it("defaults failed session-history inspection to normal", async () => {
    const test = setup();
    test.ctx.sessionManager.getBranch = () => {
      throw new Error("history");
    };
    await test.handlers.input(input(), test.ctx);
    expect(test.provider.interpret).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: "normal" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("fails open safely for typed provider failure without mutating input", async () => {
    const provider = {
      id: "local",
      interpret: vi.fn().mockRejectedValue(
        new BridgeError({
          code: "PROVIDER_TIMEOUT",
          safeMessage: "SENTINEL_SECRET",
          retryable: true,
        }),
      ),
      testConnection: vi.fn(),
    } as unknown as IntentProvider;
    const test = setup({ provider });
    const event = input({ images: [{}] });
    await expect(test.handlers.input(event, test.ctx)).resolves.toEqual({
      action: "continue",
    });
    expect(test.notices.at(-1)).toBe(
      "Intent Bridge skipped this message; the original was sent unchanged.",
    );
    expect(test.noticeLevels.at(-1)).toBe("info");
    expect(test.notices.join(" ")).not.toContain("PROVIDER_TIMEOUT");
    expect(test.notices.join(" ")).not.toContain("SENTINEL_SECRET");
    expect(
      test.handlers.before_agent_start(
        { prompt: "Profil sayfasını düzelt", images: [{}] },
        test.ctx,
      ),
    ).toBeUndefined();
  });

  it("fails open for adapter, config, context, provider construction, and missing profile errors", async () => {
    for (const options of [
      {
        loadConfig: async () => {
          throw new Error("SENTINEL_SECRET");
        },
      },
      {
        collectContext: async () => {
          throw new Error("SENTINEL_SECRET");
        },
      },
      {
        createProvider: () => {
          throw new Error("SENTINEL_SECRET");
        },
      },
      { config: config({ activeProfile: "missing" }) },
    ]) {
      const test = setup(options);
      await expect(test.handlers.input(input(), test.ctx)).resolves.toEqual({
        action: "continue",
      });
      expect(test.notices.join(" ")).not.toContain("SENTINEL_SECRET");
    }
  });

  it("passes trust to config and context without reading an untrusted project layer", async () => {
    const load = vi.fn(async (options) => {
      expect(options.projectTrusted).toBe(false);
      return config();
    });
    const context = vi.fn(async (options) => {
      expect(options.projectTrusted).toBe(false);
      return {
        context: { name: "x", instructionExcerpts: [] },
        manifest: { entries: [] },
      };
    });
    const test = setup({
      trusted: false,
      loadConfig: load,
      collectContext: context,
    });
    await test.handlers.input(input(), test.ctx);
    expect(load).toHaveBeenCalled();
    expect(context).toHaveBeenCalled();
  });

  it("records transformed and fail-open status and makes trace/prune failures nonblocking", async () => {
    const test = setup();
    test.trace.prune.mockRejectedValueOnce(new Error("nope"));
    await test.handlers.session_start({}, test.ctx);
    await test.handlers.input(input(), test.ctx);
    await test.command()("status", test.ctx);
    expect(test.notices.at(-1)).toContain("last=transformed");
    const fail = setup({
      provider: {
        id: "x",
        interpret: vi.fn().mockRejectedValue(new Error("x")),
        testConnection: vi.fn(),
      } as unknown as IntentProvider,
    });
    await fail.handlers.input(input(), fail.ctx);
    await fail.command()("status", fail.ctx);
    expect(fail.notices.at(-1)).toContain("last=fail_open");
  });

  it("clears a ready task immediately when /bridge off runs", async () => {
    const updates = vi.fn().mockResolvedValue(undefined);
    const test = setup({ updateConfig: updates });
    await test.handlers.input(input(), test.ctx);
    await test.command()("off", test.ctx);
    expect(
      test.handlers.before_agent_start(
        { prompt: "Profil sayfasını düzelt" },
        test.ctx,
      ),
    ).toBeUndefined();
    expect(test.pi.appendEntry).toHaveBeenCalledWith(
      "intent-bridge.queue",
      expect.objectContaining({ reason: "session_reset", status: "ready" }),
    );
  });

  it.each([
    "session_start",
    "session_before_switch",
    "session_shutdown",
  ])("clears ready tasks on %s", async (eventName) => {
    const test = setup();
    await test.handlers.input(input(), test.ctx);
    await test.handlers[eventName]({}, test.ctx);
    expect(
      test.handlers.before_agent_start(
        { prompt: "Profil sayfasını düzelt" },
        test.ctx,
      ),
    ).toBeUndefined();
    expect(test.pi.appendEntry).toHaveBeenCalledWith(
      "intent-bridge.queue",
      expect.objectContaining({ reason: "session_reset", status: "ready" }),
    );
  });

  it("persists deterministic on/off/auto commands and redacts status", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bridge-"));
    const updates = vi.fn().mockResolvedValue(undefined);
    const test = setup({ updateConfig: updates });
    test.ctx.cwd = directory;
    for (const command of ["off", "on", "auto"])
      await test.command()(command, test.ctx);
    expect(updates).toHaveBeenCalledTimes(3);
    expect(updates.mock.calls[0][2]).toEqual({ enabled: false, mode: "off" });
    expect(updates.mock.calls[1][2]).toEqual({ enabled: true, mode: "auto" });
    await test.command()("status", test.ctx);
    expect(test.notices.at(-1)).toContain(
      "enabled=true; mode=auto; model=bridge-model",
    );
    expect(test.notices.at(-1)).not.toContain("SENTINEL_SECRET");
    await test.command()("unknown", test.ctx);
    expect(test.notices.at(-1)).toBe(
      "Usage: /bridge on|off|model [provider/model-id|model-id]|auto|preview [off]|status|test|last|rate good|bad|logs|privacy",
    );
  });

  it("disables preview without disabling the bridge", async () => {
    const updates = vi.fn().mockResolvedValue(undefined);
    const test = setup({
      config: config({ mode: "preview" }),
      updateConfig: updates,
    });
    await test.command()("preview off", test.ctx);
    expect(updates).toHaveBeenCalledWith(expect.anything(), undefined, {
      enabled: true,
      mode: "auto",
    });
    expect(test.notices.at(-1)).toBe("Intent Bridge preview disabled.");
  });

  it("tests the active provider exactly once without exposing secrets", async () => {
    const provider = {
      id: "local",
      interpret: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ ok: true, latencyMs: 12 }),
    } as unknown as IntentProvider;
    const test = setup({ provider });
    await test.command()("test", test.ctx);
    expect(provider.testConnection).toHaveBeenCalledTimes(1);
    expect(test.notices.at(-1)).toContain(
      "ok; model=bridge-model; latency=12ms",
    );
    expect(test.notices.join(" ")).not.toContain("SENTINEL_SECRET");
  });

  it("prefers an explicit environment profile over a saved Pi selection", async () => {
    const home = await mkdtemp(join(tmpdir(), "bridge-"));
    const selectionPath = join(home, "pi-model-selection.json");
    await writeFile(
      selectionPath,
      JSON.stringify({ version: 1, provider: "pi", model: "ignored" }),
    );
    const registry = {
      refresh: vi.fn(),
      getAvailable: vi.fn(() => []),
      find: vi.fn(),
      isUsingOAuth: vi.fn(() => false),
      getApiKeyAndHeaders: vi.fn(() => {
        throw new Error("Pi auth must not resolve");
      }),
    };
    const test = setup({
      environment: {
        INTENT_BRIDGE_HOME: home,
        INTENT_BRIDGE_ACTIVE_PROFILE: "local",
        SENTINEL_SECRET: "secret",
      },
      modelRegistry: registry,
      updateConfig: vi.fn().mockResolvedValue(undefined),
    });
    await expect(test.handlers.input(input(), test.ctx)).resolves.toEqual({
      action: "continue",
    });
    expect(registry.getApiKeyAndHeaders).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(selectionPath, "utf8"))).toEqual({
      version: 1,
      provider: "pi",
      model: "ignored",
    });
  });

  it("uses a selected Pi model once with an ephemeral resolver and safe metadata", async () => {
    const home = await mkdtemp(join(tmpdir(), "bridge-"));
    await writeFile(
      join(home, "pi-model-selection.json"),
      JSON.stringify({ version: 1, provider: "pi", model: "org/model" }),
    );
    const model = {
      id: "org/model",
      name: "Model",
      api: "openai-completions",
      input: ["text"],
      contextWindow: 1000,
      provider: "pi",
      baseUrl: "https://example.test/v1",
      maxTokens: 9000,
      cost: { input: 1, output: 2 },
    };
    const registry = {
      refresh: vi.fn(),
      getAvailable: vi.fn(() => [model]),
      find: vi.fn(() => model),
      isUsingOAuth: vi.fn(() => false),
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({
        ok: true,
        apiKey: "SENTINEL_PI_KEY",
        headers: {
          Authorization: "never",
          "OpenAI-Organization": "org",
          "X-Api-Key": "never",
          "X-Token": "never",
        },
      }),
    };
    const provider = {
      id: "pi:pi",
      interpret: vi.fn().mockResolvedValue({
        intent: intent(),
        rawResponseHash: "hash",
        latencyMs: 1,
      }),
      testConnection: vi.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
    } as unknown as IntentProvider;
    const createProvider = vi.fn((_profile, resolver) => {
      expect(_profile).toMatchObject({
        id: "pi:pi",
        model: "org/model",
        timeoutMs: 30000,
        maxOutputTokens: 4096,
        temperature: 0,
        capabilities: {
          structuredOutput: "json_object",
          usageMetadata: true,
          supportsSeed: false,
        },
        pricing: { currency: "USD", inputPerMillion: 1, outputPerMillion: 2 },
        headers: { "OpenAI-Organization": "org" },
      });
      expect(resolver?.("INTENT_BRIDGE_PI_API_KEY")).toBe("SENTINEL_PI_KEY");
      expect(resolver?.("other")).toBeUndefined();
      return provider;
    });
    const test = setup({
      environment: {
        INTENT_BRIDGE_HOME: home,
        SENTINEL_SECRET: "do-not-print",
      },
      modelRegistry: registry,
      createProvider,
      createPiProvider: () => provider,
    });
    await expect(
      test.handlers.input(input({ images: [{}] }), test.ctx),
    ).resolves.toEqual({ action: "continue" });
    expect(registry.getApiKeyAndHeaders).not.toHaveBeenCalled();
    expect(createProvider).not.toHaveBeenCalled();
    expect(provider.interpret).toHaveBeenCalledTimes(1);
    await test.command()("status", test.ctx);
    expect(test.notices.at(-1)).toContain("model=org/model");
    const persisted = JSON.stringify([
      test.notices,
      test.pi.appendEntry.mock.calls,
      await readFile(join(home, "pi-model-selection.json"), "utf8"),
    ]);
    expect(persisted).not.toContain("SENTINEL_PI_KEY");
    expect(persisted).not.toContain("OpenAI-Organization");
    expect(persisted).not.toContain("never");
  });

  it("selects an exact provider/model pair through /bridge model", async () => {
    const home = await mkdtemp(join(tmpdir(), "bridge-"));
    const model = {
      id: "org/model",
      name: "Model",
      api: "openai-completions",
      input: ["text"],
      contextWindow: 1000,
      provider: "pi",
      baseUrl: "https://example.test/v1",
      maxTokens: 1000,
      cost: { input: 1, output: 1 },
    };
    const calls: string[] = [];
    const registry = {
      refresh: vi.fn(async () => calls.push("refresh")),
      getAvailable: vi.fn(() => {
        calls.push("available");
        return [model];
      }),
      find: vi.fn(() => {
        calls.push("find");
        return model;
      }),
      isUsingOAuth: vi.fn(() => false),
      getApiKeyAndHeaders: vi
        .fn()
        .mockResolvedValue({ ok: true, apiKey: "key" }),
    };
    const provider = {
      id: "pi",
      interpret: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
    } as unknown as IntentProvider;
    const test = setup({
      environment: { INTENT_BRIDGE_HOME: home, SENTINEL_SECRET: "secret" },
      modelRegistry: registry,
      provider,
    });
    await test.command()("model pi/org/model", test.ctx);
    expect(calls).toEqual(["refresh", "available", "find"]);
    expect(provider.testConnection).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(await readFile(join(home, "pi-model-selection.json"), "utf8")),
    ).toEqual({
      version: 1,
      provider: "pi",
      model: "org/model",
    });
    test.ctx.hasUI = false;
    await test.command()("model", test.ctx);
    expect(test.notices.at(-1)).toBe("No compatible Pi models are available.");
  });

  it("reports an empty Pi picker without mutation", async () => {
    const home = await mkdtemp(join(tmpdir(), "bridge-"));
    const registry = {
      refresh: vi.fn().mockResolvedValue(undefined),
      getAvailable: vi.fn(() => []),
      find: vi.fn(),
      isUsingOAuth: vi.fn(() => false),
      getApiKeyAndHeaders: vi.fn(),
    };
    const test = setup({
      config: config({ activeProfile: "", profiles: {} }),
      environment: { INTENT_BRIDGE_HOME: home, SENTINEL_SECRET: "secret" },
      modelRegistry: registry,
    });
    test.ctx.hasUI = false;
    await test.command()("model", test.ctx);
    expect(registry.refresh).toHaveBeenCalledTimes(1);
    expect(test.notices.at(-1)).toBe("No compatible Pi models are available.");
    await expect(
      readFile(join(home, "pi-model-selection.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refreshes Pi model selection, updates an exact ID, and preserves selection on cancel", async () => {
    const home = await mkdtemp(join(tmpdir(), "bridge-"));
    await writeFile(
      join(home, "pi-model-selection.json"),
      JSON.stringify({ version: 1, provider: "pi", model: "first" }),
    );
    const models = ["first", "second"].map((id) => ({
      id,
      name: id,
      api: "openai-completions",
      input: ["text"],
      contextWindow: 1000,
      provider: "pi",
      baseUrl: "https://example.test/v1",
      maxTokens: 1000,
      cost: { input: 1, output: 1 },
    }));
    const registry = {
      refresh: vi.fn().mockResolvedValue(undefined),
      getAvailable: vi.fn(() => models),
      find: vi.fn((provider, id) =>
        models.find((model) => model.provider === provider && model.id === id),
      ),
      isUsingOAuth: vi.fn(() => false),
      getApiKeyAndHeaders: vi
        .fn()
        .mockResolvedValue({ ok: true, apiKey: "key" }),
    };
    const test = setup({
      environment: { INTENT_BRIDGE_HOME: home, SENTINEL_SECRET: "secret" },
      modelRegistry: registry,
    });
    await test.command()("model second", test.ctx);
    expect(registry.refresh).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(await readFile(join(home, "pi-model-selection.json"), "utf8")),
    ).toEqual({
      version: 1,
      provider: "pi",
      model: "second",
    });
    await test.command()("model", test.ctx);
    expect(
      JSON.parse(await readFile(join(home, "pi-model-selection.json"), "utf8")),
    ).toEqual({
      version: 1,
      provider: "pi",
      model: "second",
    });
  });

  it("keeps last and rating metadata bound to the exact latest transformation", async () => {
    const first = config();
    const second = config({
      activeProfile: "other",
      profiles: {
        ...config().profiles,
        other: {
          ...config().profiles.local,
          id: "other",
          model: "other-model",
        },
      },
    });
    let current = first;
    let count = 0;
    const test = setup({
      loadConfig: async () => current,
      uuid: () => `trace-${++count}`,
      now: () => new Date(`2026-07-19T12:00:0${count}.000Z`),
    });
    await test.handlers.input(input({ text: "request A" }), test.ctx);
    current = second;
    await test.command()("rate good", test.ctx);
    expect(test.trace.append).toHaveBeenLastCalledWith(
      expect.objectContaining({
        traceId: "trace-1",
        userRating: "good",
        providerProfile: "local",
        model: "bridge-model",
        mode: "auto",
      }),
      expect.anything(),
    );
    expect(test.pi.appendEntry).toHaveBeenLastCalledWith(
      "intent-bridge.rating",
      expect.objectContaining({
        traceId: "trace-1",
        provider: "local",
        model: "bridge-model",
        mode: "auto",
      }),
    );
    await test.handlers.input(input({ text: "request B" }), test.ctx);
    await test.command()("last", test.ctx);
    const last = test.notices.at(-1) ?? "";
    expect(last).toContain("request B");
    expect(last).toContain("provider=other; model=other-model");
    expect(last).toContain("rating=none");
    expect(last).toContain("timestamp=2026-07-19T12:00:02.000Z");
    expect(last).not.toContain("request A");
    expect(last).not.toContain("provider=local");
  });

  it("shows bounded redacted last details without context bodies", async () => {
    const test = setup({
      collectContext: async () => ({
        context: { name: "project", instructionExcerpts: ["context body"] },
        manifest: { entries: [] },
      }),
    });
    await test.handlers.input(
      input({ text: "api_key=SENTINEL_SECRET_VALUE" }),
      test.ctx,
    );
    await test.command()("last", test.ctx);
    const last = test.notices.at(-1) ?? "";
    expect(last.length).toBeLessThanOrEqual(5000);
    expect(last).toContain("Original request");
    expect(last).toContain("timestamp=2026-07-19T12:00:00.000Z");
    expect(last).toContain("latency=1ms");
    expect(last).toContain("## Interpreted goal");
    expect(last).toContain("## English compiled task");
    expect(last).not.toContain("SENTINEL_SECRET_VALUE");
    expect(last).not.toContain("context body");
  });

  it.each([
    "Send original",
    "Cancel",
  ])("keeps preview %s as the latest bypass and clears its prior rating", async (choice) => {
    const current = config();
    const test = setup({
      loadConfig: async () => current,
      select: async () => choice,
    });
    await test.handlers.input(input({ text: "rated request" }), test.ctx);
    await test.command()("rate good", test.ctx);
    current.mode = "preview";
    await test.handlers.input(input({ text: "preview request" }), test.ctx);
    await test.command()("last", test.ctx);
    const last = test.notices.at(-1) ?? "";
    expect(last).toContain("Status: bypass");
    expect(last).toContain("preview request");
    expect(last).toContain("rating=none");
    expect(last).not.toContain("rated request");
  });

  it("shows bounded last output and appends ratings to the latest trace without content", async () => {
    const test = setup();
    await test.command()("last", test.ctx);
    expect(test.notices.at(-1)).toContain("no transformation");
    await test.handlers.input(input(), test.ctx);
    await test.command()("last", test.ctx);
    expect(test.notices.at(-1)).toContain("## English compiled task");
    await test.command()("rate good", test.ctx);
    expect(test.trace.append).toHaveBeenLastCalledWith(
      expect.objectContaining({ traceId: "trace-1", userRating: "good" }),
      expect.anything(),
    );
    expect(test.trace.append.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "content",
    );
    expect(test.pi.appendEntry).toHaveBeenLastCalledWith(
      "intent-bridge.rating",
      expect.objectContaining({ traceId: "trace-1", rating: "good" }),
    );
    expect(JSON.stringify(test.pi.appendEntry.mock.calls)).not.toContain(
      "Profil sayfasını düzelt",
    );
  });

  it("keeps rating custom metadata when persistent logging is off", async () => {
    const test = setup({
      config: config({ logging: { mode: "off", retentionDays: 7 } }),
    });
    await test.handlers.input(input(), test.ctx);
    test.trace.append.mockClear();
    await test.command()("rate bad", test.ctx);
    expect(test.trace.append).toHaveBeenCalledTimes(1);
    expect(test.pi.appendEntry).toHaveBeenCalledWith(
      "intent-bridge.rating",
      expect.objectContaining({ rating: "bad" }),
    );
  });

  it("reports logs and privacy metadata without reading bodies", async () => {
    const test = setup({
      config: config({ logging: { mode: "full", retentionDays: 7 } }),
      collectContext: async () => ({
        context: {
          name: "project",
          summary: "SENTINEL_SECRET",
          instructionExcerpts: ["body"],
        },
        manifest: {
          totalCharacters: 12,
          entries: [
            { path: "AGENTS.md", included: true },
            { path: ".env", included: false, reason: "denied" },
          ],
        },
      }),
    });
    await test.command()("logs", test.ctx);
    expect(test.notices.at(-1)).toContain("mode=full; retention=7 days");
    await test.command()("privacy", test.ctx);
    expect(test.notices.at(-1)).toContain("included=1; excluded=1; chars=12");
    expect(test.notices.at(-1)).toContain("AGENTS.md");
    expect(test.notices.at(-1)).not.toContain("SENTINEL_SECRET");
    expect(test.notices.at(-1)).not.toContain("body");
  });

  it("does not bake environment overrides into the global layer", async () => {
    const home = await mkdtemp(join(tmpdir(), "bridge-"));
    await writeFile(
      join(home, "config.json"),
      JSON.stringify({ version: 1, profiles: config().profiles }),
    );
    const test = setup({
      environment: {
        INTENT_BRIDGE_HOME: home,
        INTENT_BRIDGE_ENABLED: "false",
        INTENT_BRIDGE_MODE: "preview",
        INTENT_BRIDGE_CONTEXT_ENABLED: "false",
        INTENT_BRIDGE_LOGGING_MODE: "full",
        INTENT_BRIDGE_ACTIVE_PROFILE: "environment-profile",
      },
    });
    await test.command()("auto", test.ctx);
    expect(
      JSON.parse(await readFile(join(home, "config.json"), "utf8")),
    ).toEqual({
      version: 1,
      profiles: config().profiles,
      enabled: true,
      mode: "auto",
    });
  });

  it("updates a trusted partial project layer without flattening global config", async () => {
    const home = await mkdtemp(join(tmpdir(), "bridge-"));
    const project = await mkdtemp(join(tmpdir(), "project-"));
    const global = config({
      context: { enabled: true, maxCharacters: 999, maxFileCharacters: 555 },
      logging: { mode: "full", retentionDays: 9 },
    });
    await writeFile(join(home, "config.json"), JSON.stringify(global));
    await mkdir(join(project, ".pi"));
    await writeFile(
      join(project, ".pi", "intent-bridge.json"),
      JSON.stringify({ version: 1, quality: {} }),
    );
    const test = setup({ environment: { INTENT_BRIDGE_HOME: home } });
    test.ctx.cwd = project;
    await test.command()("off", test.ctx);
    expect(
      JSON.parse(
        await readFile(join(project, ".pi", "intent-bridge.json"), "utf8"),
      ),
    ).toEqual({ version: 1, quality: {}, enabled: false, mode: "off" });
    await expect(
      loadLayeredConfig({
        home,
        projectRoot: project,
        configDirName: ".pi",
        projectTrusted: true,
        environment: {},
      }),
    ).resolves.toMatchObject({
      enabled: false,
      mode: "off",
      profiles: global.profiles,
      context: global.context,
      logging: global.logging,
    });
  });

  it("preserves global provider configuration when no project layer exists", async () => {
    const home = await mkdtemp(join(tmpdir(), "bridge-"));
    const global = config();
    await writeFile(join(home, "config.json"), JSON.stringify(global));
    const test = setup({ environment: { INTENT_BRIDGE_HOME: home } });
    await test.command()("off", test.ctx);
    expect(
      JSON.parse(await readFile(join(home, "config.json"), "utf8")),
    ).toEqual({
      ...global,
      enabled: false,
      mode: "off",
    });
  });
});

describe("Intent Bridge quality review delivery matrix", () => {
  it("passes config.quality into the pipeline run", async () => {
    const test = setup({
      config: config({
        quality: {
          enforcement: "review",
          reviewOnHighRisk: true,
          reviewOnClarification: true,
          reviewOnMaterialAskUser: true,
          minConfidence: 0.5,
          noUiAction: "send_original",
        },
      }),
    });
    await test.handlers.input(input(), test.ctx);
    const successTrace = test.trace.append.mock.calls[0]?.[0];
    expect(successTrace).toMatchObject({ status: "success" });
    const assessment = (
      successTrace as { assessment?: { policyVersion: string } }
    ).assessment;
    expect(assessment?.policyVersion).toBe("quality-policy-v1");
  });

  it("observes a review-candidate in auto mode and still injects the compiled task", async () => {
    const provider = {
      id: "local",
      interpret: vi.fn().mockResolvedValue({
        intent: reviewIntent(),
        rawResponseHash: "hash",
        latencyMs: 1,
      }),
      testConnection: vi.fn(),
    } as unknown as IntentProvider;
    const test = setup({ provider });
    await expect(test.handlers.input(input(), test.ctx)).resolves.toEqual({
      action: "continue",
    });
    expect(
      test.handlers.before_agent_start(
        { prompt: "Profil sayfasını düzelt" },
        test.ctx,
      ),
    ).toMatchObject({
      message: { display: false, content: expect.any(String) },
    });
    expect(test.notices.join(" ")).not.toMatch(
      /Intent Bridge skipped this message/,
    );
  });

  it("injects when auto + review enforcement + accept outcome", async () => {
    const provider = {
      id: "local",
      interpret: vi.fn().mockResolvedValue({
        intent: intent(),
        rawResponseHash: "hash",
        latencyMs: 1,
      }),
      testConnection: vi.fn(),
    } as unknown as IntentProvider;
    const test = setup({
      provider,
      config: config({
        quality: {
          enforcement: "review",
          reviewOnHighRisk: true,
          reviewOnClarification: true,
          reviewOnMaterialAskUser: true,
          minConfidence: null,
          noUiAction: "send_original",
        },
      }),
    });
    await test.handlers.input(input(), test.ctx);
    expect(
      test.handlers.before_agent_start(
        { prompt: "Profil sayfasını düzelt" },
        test.ctx,
      ),
    ).toMatchObject({
      message: { display: false, content: expect.any(String) },
    });
  });

  it("opens the existing preview selector when auto + review + UI is available", async () => {
    const provider = {
      id: "local",
      interpret: vi.fn().mockResolvedValue({
        intent: reviewIntent(),
        rawResponseHash: "hash",
        latencyMs: 1,
      }),
      testConnection: vi.fn(),
    } as unknown as IntentProvider;
    const select = vi.fn(async (title: string) => {
      expect(title).toContain("## Quality assessment");
      return "Send transformed";
    });
    const test = setup({
      provider,
      config: config({
        quality: {
          enforcement: "review",
          reviewOnHighRisk: true,
          reviewOnClarification: true,
          reviewOnMaterialAskUser: true,
          minConfidence: null,
          noUiAction: "send_original",
        },
      }),
      select,
    });
    await expect(test.handlers.input(input(), test.ctx)).resolves.toEqual({
      action: "continue",
    });
    expect(select).toHaveBeenCalledTimes(1);
    expect(
      test.handlers.before_agent_start(
        { prompt: "Profil sayfasını düzelt" },
        test.ctx,
      ),
    ).toMatchObject({ message: { display: false } });
  });

  it("preserves the original and queues nothing when auto + review + no UI", async () => {
    const provider = {
      id: "local",
      interpret: vi.fn().mockResolvedValue({
        intent: reviewIntent(),
        rawResponseHash: "hash",
        latencyMs: 1,
      }),
      testConnection: vi.fn(),
    } as unknown as IntentProvider;
    const test = setup({
      provider,
      config: config({
        quality: {
          enforcement: "review",
          reviewOnHighRisk: true,
          reviewOnClarification: true,
          reviewOnMaterialAskUser: true,
          minConfidence: null,
          noUiAction: "send_original",
        },
      }),
    });
    test.ctx.hasUI = false;
    await expect(test.handlers.input(input(), test.ctx)).resolves.toEqual({
      action: "continue",
    });
    expect(
      test.handlers.before_agent_start(
        { prompt: "Profil sayfasını düzelt" },
        test.ctx,
      ),
    ).toBeUndefined();
    expect(test.trace.append).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "bypass",
        bypassReason: "quality_review_required_no_ui",
      }),
      expect.anything(),
    );
    expect(test.notices.join(" ")).not.toMatch(
      /Intent Bridge skipped this message/,
    );
    await test.command()("status", test.ctx);
    expect(test.notices.at(-1)).toContain("last=bypass");
  });

  it("preserves the original on preview + no UI before any context or provider work", async () => {
    const test = setup({ config: config({ mode: "preview" }) });
    test.ctx.hasUI = false;
    await expect(test.handlers.input(input(), test.ctx)).resolves.toEqual({
      action: "continue",
    });
    expect(test.collectContext).not.toHaveBeenCalled();
    expect(test.createProvider).not.toHaveBeenCalled();
    expect(test.trace.append).toHaveBeenCalledWith(
      expect.objectContaining({ bypassReason: "preview_ui_unavailable" }),
      expect.anything(),
    );
  });

  it("renders assessment fields in preview and last diagnostics", async () => {
    const test = setup({
      config: config({ mode: "preview" }),
      select: async () => "Send original",
    });
    const sensitivePrompt = `fix profile ${["api", "key"].join("_")}=SENTINEL_SECRET_VALUE`;
    await test.handlers.input(input({ text: sensitivePrompt }), test.ctx);
    await test.command()("last", test.ctx);
    const last = test.notices.at(-1) ?? "";
    expect(last).toContain("## Quality assessment");
    expect(last).toContain("## Risk");
    expect(last).toContain("## Clarification");
    expect(last).toContain("## Material ask_user ambiguities");
    expect(last).toContain("Enforcement: observe");
    expect(last).not.toContain("SENTINEL_SECRET_VALUE");
  });

  it("renders the active review enforcement and a high risk signal in last diagnostics", async () => {
    const provider = {
      id: "local",
      interpret: vi.fn().mockResolvedValue({
        intent: reviewIntent(),
        rawResponseHash: "hash",
        latencyMs: 1,
      }),
      testConnection: vi.fn(),
    } as unknown as IntentProvider;
    const test = setup({
      provider,
      config: config({
        quality: {
          enforcement: "review",
          reviewOnHighRisk: true,
          reviewOnClarification: true,
          reviewOnMaterialAskUser: true,
          minConfidence: null,
          noUiAction: "send_original",
        },
      }),
      select: async () => "Send original",
    });
    await test.handlers.input(input(), test.ctx);
    await test.command()("last", test.ctx);
    const last = test.notices.at(-1) ?? "";
    expect(last).toContain("Outcome: review");
    expect(last).toContain("high_risk");
    expect(last).toContain("Enforcement: review");
  });
});
