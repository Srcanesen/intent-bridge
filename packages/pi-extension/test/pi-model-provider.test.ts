import { describe, expect, it, vi } from "vitest";

import {
  compatiblePiModels,
  piModelChoices,
  resolvePiModel,
  type PiModel,
  type PiModelRegistry,
} from "../src/pi-model-provider.js";

const model = (patch: Partial<PiModel> = {}): PiModel => ({
  id: "model",
  name: "Model",
  provider: "provider",
  input: ["text"],
  contextWindow: 128000,
  maxTokens: 1000,
  ...patch,
});

const registry = (selected?: PiModel): PiModelRegistry => ({
  refresh: vi.fn(),
  getAvailable: vi.fn(() => (selected ? [selected] : [])),
  find: vi.fn(() => selected),
});

describe("Pi model selection", () => {
  it("includes configured native API, OAuth, header, and env transports without auth resolution", () => {
    const models = [
      model({ api: "anthropic-messages", provider: "oauth" }),
      model({ api: "openai-responses", provider: "header" }),
      model({ api: "openai-codex-responses", provider: "codex" }),
      model({ api: "openai-completions", provider: "env" }),
      model({ id: "image", input: ["image"] }),
      model({ id: "no-off", reasoning: true, thinkingLevelMap: { off: null } }),
      model({ id: "bad-context", contextWindow: 0 }),
      model({ id: "bad-output", maxTokens: Number.NaN }),
    ];
    expect(compatiblePiModels(models).map(({ provider }) => provider)).toEqual([
      "codex",
      "env",
      "header",
      "oauth",
    ]);
    expect(
      piModelChoices(compatiblePiModels(models)).map(({ label }) => label),
    ).toContain("Model — model (oauth)");
  });

  it("resolves only compatible model metadata synchronously", () => {
    const selected = model();
    const pi = registry(selected) as PiModelRegistry & {
      getApiKeyAndHeaders: ReturnType<typeof vi.fn>;
      isUsingOAuth: ReturnType<typeof vi.fn>;
    };
    pi.getApiKeyAndHeaders = vi.fn();
    pi.isUsingOAuth = vi.fn();
    expect(resolvePiModel(pi, "provider", "model")).toBe(selected);
    expect(pi.getApiKeyAndHeaders).not.toHaveBeenCalled();
    expect(pi.isUsingOAuth).not.toHaveBeenCalled();
    expect(() => resolvePiModel(registry(), "provider", "model")).toThrow(
      "Missing model",
    );
    expect(() =>
      resolvePiModel(
        registry(model({ input: ["image"] })),
        "provider",
        "model",
      ),
    ).toThrow("not compatible");
  });
});
