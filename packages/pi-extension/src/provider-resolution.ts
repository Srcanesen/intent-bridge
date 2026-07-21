import {
  BridgeError,
  loadPiModelSelection,
  type IntentProvider,
  type ProviderProfileV1,
  writePiModelSelectionAtomic,
} from "@intent-bridge/core";

import {
  compatiblePiModels,
  type PiModel,
  type PiModelRegistry,
  piModelChoices,
  resolvePiModel,
} from "./pi-model-provider.js";
import type { PiNativeProviderOptions } from "./pi-native-provider.js";

export interface ProviderResolutionDependencies {
  environment: NodeJS.ProcessEnv;
  selectionPath: string;
  createProvider: (
    profile: ProviderProfileV1,
    environment?: (name: string) => string | undefined,
  ) => IntentProvider;
  createPiProvider: (
    registry: PiModelRegistry,
    model: PiModel,
    options?: PiNativeProviderOptions,
  ) => IntentProvider;
  loadPiSelection?: typeof loadPiModelSelection;
  savePiSelection?: typeof writePiModelSelectionAtomic;
  capabilityDiagnostic: NonNullable<
    PiNativeProviderOptions["capabilityDiagnostic"]
  >;
}

type Config = {
  activeProfile: string;
  profiles: Record<string, ProviderProfileV1>;
};
type Selection = Awaited<ReturnType<typeof loadPiModelSelection>>;

export type ActiveProvider =
  | { source: "profile"; id: string; profile: ProviderProfileV1 | undefined }
  | { source: "pi"; selection: NonNullable<Selection> };

export type ModelSelectionResult =
  | { kind: "selected"; model: PiModel }
  | { kind: "unavailable" }
  | { kind: "cancelled" }
  | { kind: "no-compatible" }
  | { kind: "failed"; hadPrevious: boolean };

function requireProfile(
  profile: ProviderProfileV1 | undefined,
): ProviderProfileV1 {
  if (profile) return profile;
  throw new BridgeError({
    code: "CONFIG_MISSING",
    safeMessage: "Missing profile.",
    retryable: false,
  });
}

export function createProviderResolver(
  dependencies: ProviderResolutionDependencies,
) {
  const loadSelection = dependencies.loadPiSelection ?? loadPiModelSelection;
  const saveSelection =
    dependencies.savePiSelection ?? writePiModelSelectionAtomic;
  const selection = () => loadSelection(dependencies.selectionPath);
  const active = async (config: Config): Promise<ActiveProvider> => {
    const envProfile =
      dependencies.environment.INTENT_BRIDGE_ACTIVE_PROFILE?.trim();
    if (envProfile)
      return {
        source: "profile",
        id: envProfile,
        profile: config.profiles[envProfile],
      };
    const selected = await selection();
    if (selected) return { source: "pi", selection: selected };
    return {
      source: "profile",
      id: config.activeProfile,
      profile: config.profiles[config.activeProfile],
    };
  };
  const resolve = async (config: Config, registry: PiModelRegistry) => {
    const effective = await active(config);
    const model =
      effective.source === "pi"
        ? resolvePiModel(
            registry,
            effective.selection.provider,
            effective.selection.model,
          )
        : undefined;
    const profile =
      effective.source === "profile" ? effective.profile : undefined;
    if (!model && !profile) requireProfile(profile);
    return {
      effective,
      provider: model
        ? dependencies.createPiProvider(registry, model, {
            capabilityDiagnostic: dependencies.capabilityDiagnostic,
          })
        : dependencies.createProvider(requireProfile(profile)),
      providerProfileId: model
        ? `pi:${model.provider}`
        : effective.source === "profile"
          ? effective.id
          : "",
      model: model?.id ?? requireProfile(profile).model,
      promptVersion: model ? "pi-native-v2" : "openai-compatible-v2",
      ...(profile?.pricing ? { pricing: profile.pricing } : {}),
    };
  };
  const selectModel = async (
    registry: PiModelRegistry,
    requested?: string,
    pick?: (choices: readonly string[]) => Promise<string | undefined>,
    signal?: AbortSignal,
  ): Promise<ModelSelectionResult> => {
    await registry.refresh();
    const choices = piModelChoices(compatiblePiModels(registry.getAvailable()));
    if (!choices.length && !requested) return { kind: "no-compatible" };
    let choice = requested
      ? (() => {
          const [provider, id] = requested.split(/\/(.*)/s);
          const matches = requested.includes("/")
            ? choices.filter(
                ({ model }) => model.provider === provider && model.id === id,
              )
            : choices.filter(({ model }) => model.id === requested);
          return matches.length === 1 ? matches[0] : undefined;
        })()
      : undefined;
    if (!requested) {
      if (!pick) return { kind: "no-compatible" };
      const picked = await pick(choices.map(({ label }) => label));
      choice = choices.find(({ label }) => label === picked);
      if (!choice) return { kind: "cancelled" };
    }
    if (!choice) return { kind: "unavailable" };
    const previous = await selection();
    try {
      const model = resolvePiModel(
        registry,
        choice.model.provider,
        choice.model.id,
      );
      await dependencies
        .createPiProvider(registry, model, {
          capabilityDiagnostic: dependencies.capabilityDiagnostic,
        })
        .testConnection({ ...(signal ? { signal } : {}) });
      await saveSelection(dependencies.selectionPath, {
        version: 1,
        provider: choice.model.provider,
        model: choice.model.id,
      });
      return { kind: "selected", model: choice.model };
    } catch {
      return { kind: "failed", hadPrevious: Boolean(previous) };
    }
  };
  const isSelectedModelAvailable = async (
    registry: PiModelRegistry,
    selected: NonNullable<Selection>,
  ) => {
    await registry.refresh();
    return compatiblePiModels(registry.getAvailable()).some(
      (model) =>
        model.provider === selected.provider && model.id === selected.model,
    );
  };
  return { active, resolve, selectModel, isSelectedModelAvailable };
}
