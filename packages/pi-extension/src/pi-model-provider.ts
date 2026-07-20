import { BridgeError } from "@intent-bridge/core";

/** Structural host model shape; the extension must not bundle pi-ai. */
export interface PiModel {
  id: string;
  name: string;
  provider: string;
  api?: string;
  input?: readonly string[];
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, unknown>;
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number };
}

export interface PiModelRegistry {
  refresh(): Promise<void>;
  getAvailable(): readonly PiModel[];
  find(provider: string, modelId: string): PiModel | undefined;
}

export interface PiModelChoice {
  label: string;
  model: PiModel;
}

export function isCompatiblePiModel(model: PiModel): boolean {
  return (
    model.input?.includes("text") === true &&
    Number.isFinite(model.contextWindow) &&
    (model.contextWindow ?? 0) > 0 &&
    Number.isFinite(model.maxTokens) &&
    (model.maxTokens ?? 0) > 0 &&
    !(model.reasoning === true && model.thinkingLevelMap?.off === null)
  );
}

export function compatiblePiModels(models: readonly PiModel[]): PiModel[] {
  return models
    .filter(isCompatiblePiModel)
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id) ||
        a.provider.localeCompare(b.provider),
    );
}

export function piModelChoices(models: readonly PiModel[]): PiModelChoice[] {
  return models.map((model) => ({
    model,
    label: `${model.name} — ${model.id} (${model.provider})`,
  }));
}

function unavailable(code: "CONFIG_MISSING" | "CONFIG_INVALID"): never {
  throw new BridgeError({
    code,
    safeMessage:
      code === "CONFIG_MISSING"
        ? "Missing model."
        : "The selected Pi model is not compatible.",
    retryable: false,
  });
}

/** Resolves only model metadata; Pi's host runtime owns auth and transport. */
export function resolvePiModel(
  registry: PiModelRegistry,
  provider: string,
  id: string,
): PiModel {
  const model = registry.find(provider, id);
  if (!model) unavailable("CONFIG_MISSING");
  if (!isCompatiblePiModel(model)) unavailable("CONFIG_INVALID");
  return model;
}
