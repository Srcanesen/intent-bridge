import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  BridgeError,
  collectProjectContext,
  InterpretationPipeline,
  JsonlTraceWriter,
  loadBridgeConfigLayer,
  loadPiModelSelection,
  loadLayeredConfig,
  PiCompilerV1,
  resolveConfigPaths,
  updateBridgeConfigLayerAtomic,
  writePiModelSelectionAtomic,
  type BridgeTraceV1,
  type IntentProvider,
  type ProviderProfileV1,
  fullLoggingWarning,
  redactSecrets,
  type TraceSink,
} from "@intent-bridge/core";
import { OpenAICompatibleProvider } from "@intent-bridge/provider-openai-compatible";
import {
  CONFIG_DIR_NAME,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type InputEvent,
} from "@earendil-works/pi-coding-agent";

import {
  PREVIEW_CHOICES,
  formatLastTransformation,
  formatTransformation,
} from "./preview.js";
import { eligibility, messageType } from "./routing.js";
import {
  compatiblePiModels,
  piModelChoices,
  resolvePiModel,
  type PiModel,
  type PiModelRegistry,
} from "./pi-model-provider.js";
import { createPiProvider } from "./pi-native-provider.js";

export interface BridgeDependencies {
  environment?: NodeJS.ProcessEnv;
  uuid?: () => string;
  now?: () => Date;
  loadConfig?: typeof loadLayeredConfig;
  collectContext?: typeof collectProjectContext;
  /** Explicit legacy Bridge profiles only. */
  createProvider?: (
    profile: ProviderProfileV1,
    environment?: (name: string) => string | undefined,
  ) => IntentProvider;
  createPiProvider?: (
    registry: PiModelRegistry,
    model: PiModel,
  ) => IntentProvider;
  createTraceWriter?: (logsDir: string) => JsonlTraceWriter;
  updateConfig?: typeof updateBridgeConfigLayerAtomic;
}

interface BridgeState {
  lastStatus: "none" | "transformed" | "fail_open" | "bypass";
  latest?: ReturnType<InterpretationPipeline["getLatest"]>;
  latestMetadata?: {
    providerProfileId: string;
    model: string;
    mode: "auto" | "preview" | "off";
    latencyMs?: number;
  };
  rating?: "good" | "bad";
}

const usage =
  "Usage: /bridge on|off|model [provider/model-id|model-id]|auto|preview [off]|status|test|last|rate good|bad|logs|privacy";
const bridgeArgumentItems = [
  "on",
  "off",
  "auto",
  "preview",
  "preview off",
  "model",
  "status",
  "test",
  "last",
  "rate good",
  "rate bad",
  "logs",
  "privacy",
].map((value) => ({ value, label: value }));

class BufferedTraceSink implements TraceSink {
  trace?: BridgeTraceV1;
  async append(trace: BridgeTraceV1): Promise<void> {
    this.trace = trace;
  }
}

function hasPriorUserMessage(ctx: ExtensionContext): boolean {
  return ctx.sessionManager
    .getBranch()
    .some(
      (entry) =>
        entry.type === "message" &&
        (entry as { message?: { role?: unknown } }).message?.role === "user",
    );
}
function errorCode(error: unknown): string {
  return error instanceof BridgeError ? error.code : "CONFIG_INVALID";
}
function notify(ctx: ExtensionContext, message: string): void {
  ctx.ui.notify(message, "info");
}
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
function configOptions(ctx: ExtensionContext, environment: NodeJS.ProcessEnv) {
  return {
    projectRoot: ctx.cwd,
    configDirName: CONFIG_DIR_NAME,
    projectTrusted: ctx.isProjectTrusted(),
    environment,
  };
}

export function createIntentBridgeExtension(
  pi: ExtensionAPI,
  dependencies: BridgeDependencies = {},
): void {
  const environment = dependencies.environment ?? process.env;
  const uuid = dependencies.uuid ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());
  const loadConfig = dependencies.loadConfig ?? loadLayeredConfig;
  const collectContext = dependencies.collectContext ?? collectProjectContext;
  const createProvider =
    dependencies.createProvider ??
    ((profile, resolver) =>
      new OpenAICompatibleProvider(profile, {
        environment: resolver ?? ((name) => environment[name]),
      }));
  const createPiNativeProvider =
    dependencies.createPiProvider ?? createPiProvider;
  const createTraceWriter =
    dependencies.createTraceWriter ??
    ((path) => new JsonlTraceWriter(path, now));
  const updateConfig =
    dependencies.updateConfig ?? updateBridgeConfigLayerAtomic;
  const state: BridgeState = { lastStatus: "none" };
  const queuedTasks: Array<{ prompt: string; content: string }> = [];
  const queueTask = (prompt: string, content: string) => {
    // ponytail: retain 20 pending prompts; add session-scoped IDs if concurrent turns need more.
    if (queuedTasks.length === 20) queuedTasks.shift();
    queuedTasks.push({ prompt, content });
  };
  const globalDir = dirname(resolveConfigPaths({ environment }).globalPath);
  const selectionPath = join(globalDir, "pi-model-selection.json");
  const logsDir = join(globalDir, "logs");
  const traceWriter = createTraceWriter(logsDir);
  const getConfig = (ctx: ExtensionContext) =>
    loadConfig(configOptions(ctx, environment));
  const piSelection = () => loadPiModelSelection(selectionPath);
  const activeProfile = (
    config: Awaited<ReturnType<typeof getConfig>>,
    selection: Awaited<ReturnType<typeof piSelection>>,
  ) => {
    const envProfile = environment.INTENT_BRIDGE_ACTIVE_PROFILE?.trim();
    if (envProfile)
      return {
        source: "profile" as const,
        id: envProfile,
        profile: config.profiles[envProfile],
      };
    if (selection) return { source: "pi" as const, selection };
    return {
      source: "profile" as const,
      id: config.activeProfile,
      profile: config.profiles[config.activeProfile],
    };
  };
  const append = async (
    trace: BridgeTraceV1,
    logging: { mode: "metadata" | "full" | "off" },
  ) => traceWriter.append(trace, logging).catch(() => undefined);
  const setLatest = (
    latest: NonNullable<BridgeState["latest"]>,
    metadata: NonNullable<BridgeState["latestMetadata"]>,
  ) => {
    state.latest = latest;
    state.latestMetadata = metadata;
    delete state.rating;
  };

  pi.on("input", async (event: InputEvent, ctx) => {
    const syntax = eligibility(event);
    if (
      !syntax.eligible &&
      syntax.reason !== "disabled" &&
      syntax.reason !== "mode"
    )
      return { action: "continue" };
    let config: Awaited<ReturnType<typeof getConfig>>;
    try {
      config = await getConfig(ctx);
      if (!eligibility(event, config).eligible) return { action: "continue" };
      const source: "interactive" | "rpc" =
        event.source === "rpc" ? "rpc" : "interactive";
      const traceId = uuid();
      const timestamp = now().toISOString();
      const inputMeta = {
        version: 1 as const,
        traceId,
        timestamp,
        mode: config.mode,
        status: "bypass" as const,
        bypassReason: "preview_ui_unavailable",
        messageType: messageType(event, () => hasPriorUserMessage(ctx)),
      };
      if (config.mode === "preview" && !ctx.hasUI) {
        await append(inputMeta, config.logging);
        state.lastStatus = "bypass";
        return { action: "continue" };
      }
      const effective = activeProfile(config, await piSelection());
      const model =
        effective.source === "pi"
          ? resolvePiModel(
              ctx.modelRegistry as unknown as PiModelRegistry,
              effective.selection.provider,
              effective.selection.model,
            )
          : undefined;
      const profile = effective.profile;
      if (!model && !profile)
        throw new BridgeError({
          code: "CONFIG_MISSING",
          safeMessage: "Missing profile.",
          retryable: false,
        });
      const providerId = model ? `pi:${model.provider}` : (effective.id ?? "");
      const context = await collectContext({
        cwd: ctx.cwd,
        config: config.context,
        projectTrusted: ctx.isProjectTrusted(),
        configDirName: CONFIG_DIR_NAME,
      });
      const buffered = new BufferedTraceSink();
      const pipeline = new InterpretationPipeline(
        model
          ? createPiNativeProvider(
              ctx.modelRegistry as unknown as PiModelRegistry,
              model,
            )
          : createProvider(requireProfile(profile)),
        new PiCompilerV1(),
        buffered,
        now,
      );
      const result = await pipeline.run(
        {
          traceId,
          receivedAt: timestamp,
          harness: "pi",
          messageType: inputMeta.messageType,
          source,
          originalText: event.text,
          attachmentSummary: { imageCount: event.images?.length ?? 0 },
          project: context.context,
        },
        {
          mode: config.mode,
          logging: config.logging,
          providerProfileId: providerId,
          model: model?.id ?? requireProfile(profile).model,
          ...(profile?.pricing ? { pricing: profile.pricing } : {}),
          promptVersion: model ? "pi-native-v1" : "openai-compatible-v1",
          retryPolicy: config.retry,
          contextManifest: context.manifest,
          projectId: ctx.cwd,
          sessionId: ctx.sessionManager.getSessionId(),
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        },
      );
      if (result.status !== "transformed") {
        if (buffered.trace) await append(buffered.trace, config.logging);
        state.lastStatus = "fail_open";
        notify(
          ctx,
          "Intent Bridge skipped this message; the original was sent unchanged.",
        );
        return { action: "continue" };
      }
      const latest = pipeline.getLatest();
      if (!latest) throw new Error("Missing latest transformation.");
      setLatest(latest, {
        providerProfileId: providerId,
        model: model?.id ?? requireProfile(profile).model,
        mode: config.mode,
        ...(buffered.trace?.latencyMs === undefined
          ? {}
          : { latencyMs: buffered.trace.latencyMs }),
      });
      if (config.mode !== "preview") {
        if (buffered.trace) await append(buffered.trace, config.logging);
        state.lastStatus = "transformed";
        queueTask(event.text, result.compiledTask);
        return { action: "continue" };
      }
      let choice: string | undefined;
      try {
        choice = await ctx.ui.select(formatTransformation(latest), [
          ...PREVIEW_CHOICES,
        ]);
      } catch {
        choice = undefined;
        if (buffered.trace) {
          buffered.trace.status = "bypass";
          buffered.trace.bypassReason = "preview_ui_failed";
        }
        if (buffered.trace) await append(buffered.trace, config.logging);
        state.lastStatus = "bypass";
        return { action: "continue" };
      }
      const action =
        choice === "Send transformed"
          ? "transform"
          : choice === "Send original"
            ? "continue"
            : "handled";
      if (action !== "transform" && buffered.trace) {
        buffered.trace.status = "bypass";
        buffered.trace.bypassReason =
          action === "continue" ? "preview_send_original" : "preview_cancelled";
      }
      if (buffered.trace) await append(buffered.trace, config.logging);
      try {
        pi.appendEntry("intent-bridge.preview", {
          traceId,
          action,
          timestamp: now().toISOString(),
        });
      } catch {}
      state.lastStatus = action === "transform" ? "transformed" : "bypass";
      if (action === "transform") {
        queueTask(event.text, result.compiledTask);
        return { action: "continue" };
      }
      return { action };
    } catch {
      state.lastStatus = "fail_open";
      notify(
        ctx,
        "Intent Bridge skipped this message; the original was sent unchanged.",
      );
      return { action: "continue" };
    }
  });

  pi.on("before_agent_start", (event) => {
    const index = queuedTasks.findIndex((task) => task.prompt === event.prompt);
    if (index < 0) return;
    const task = queuedTasks[index];
    if (!task) return;
    queuedTasks.splice(index, 1);
    return {
      message: {
        customType: "intent-bridge.task",
        content: task.content,
        display: false,
      },
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    queuedTasks.length = 0;
    try {
      const config = await getConfig(ctx);
      await traceWriter
        .prune(config.logging.retentionDays)
        .catch(() => undefined);
    } catch {}
  });
  pi.on("session_before_switch", () => {
    queuedTasks.length = 0;
  });
  pi.on("session_shutdown", () => {
    queuedTasks.length = 0;
    state.latest = undefined;
    delete state.latestMetadata;
    delete state.rating;
    state.lastStatus = "none";
  });
  pi.registerCommand("bridge", {
    description: "Manage Intent Bridge settings",
    getArgumentCompletions: (prefix) => {
      const normalized = prefix.trimStart().toLowerCase();
      const matches = bridgeArgumentItems.filter(({ value }) =>
        value.startsWith(normalized),
      );
      return matches.length > 0 ? matches : null;
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const [command, value] = parts;
      if (
        !command ||
        parts.length > 2 ||
        ![
          "on",
          "off",
          "auto",
          "preview",
          "status",
          "model",
          "test",
          "last",
          "rate",
          "logs",
          "privacy",
        ].includes(command)
      ) {
        notify(ctx, usage);
        return;
      }
      try {
        const config = await getConfig(ctx);
        const paths = resolveConfigPaths({
          projectRoot: ctx.cwd,
          configDirName: CONFIG_DIR_NAME,
          environment,
        });
        const target =
          ctx.isProjectTrusted() &&
          paths.projectPath &&
          existsSync(paths.projectPath)
            ? paths.projectPath
            : paths.globalPath;
        const base =
          target === paths.projectPath
            ? await loadBridgeConfigLayer(paths.globalPath)
            : undefined;
        const save = (patch: Parameters<typeof updateConfig>[2]) =>
          updateConfig(target, base, patch);
        const selectPiModel = async (requested?: string): Promise<boolean> => {
          await ctx.modelRegistry.refresh();
          const choices = piModelChoices(
            compatiblePiModels(ctx.modelRegistry.getAvailable() as PiModel[]),
          );
          let choice = requested
            ? (() => {
                const [provider, id] = requested.split(/\/(.*)/s);
                const matches = requested.includes("/")
                  ? choices.filter(
                      ({ model }) =>
                        model.provider === provider && model.id === id,
                    )
                  : choices.filter(({ model }) => model.id === requested);
                return matches.length === 1 ? matches[0] : undefined;
              })()
            : undefined;
          if (!requested) {
            if (!choices.length || !ctx.hasUI) {
              notify(ctx, "No compatible Pi models are available.");
              return false;
            }
            const picked = await ctx.ui.select(
              "Select Intent Bridge model",
              choices.map(({ label }) => label),
            );
            choice = choices.find(({ label }) => label === picked);
            if (!choice) {
              notify(ctx, "Intent Bridge model selection cancelled.");
              return false;
            }
          }
          if (!choice) {
            notify(
              ctx,
              "That model is not available. Use /bridge model to choose one.",
            );
            return false;
          }
          const previous = await piSelection();
          try {
            const model = resolvePiModel(
              ctx.modelRegistry as unknown as PiModelRegistry,
              choice.model.provider,
              choice.model.id,
            );
            await createPiNativeProvider(
              ctx.modelRegistry as unknown as PiModelRegistry,
              model,
            ).testConnection({ ...(ctx.signal ? { signal: ctx.signal } : {}) });
            await writePiModelSelectionAtomic(selectionPath, {
              version: 1,
              provider: choice.model.provider,
              model: choice.model.id,
            });
            notify(ctx, `Intent Bridge is ready with ${choice.model.name}.`);
            return true;
          } catch {
            notify(
              ctx,
              `Intent Bridge could not use that model.${previous ? " The previous selection was kept." : ""} Try /bridge model again.`,
            );
            return false;
          }
        };
        if (command === "status") {
          if (value) {
            notify(ctx, usage);
            return;
          }
          const effective = activeProfile(config, await piSelection());
          const model =
            effective.source === "pi"
              ? effective.selection.model
              : (effective.profile?.model ?? "none");
          notify(
            ctx,
            `Intent Bridge: enabled=${config.enabled}; mode=${config.mode}; model=${model}; context=${config.context.enabled ? (ctx.isProjectTrusted() ? "enabled/trusted" : "enabled/untrusted") : "disabled"}; logging=${config.logging.mode}; last=${state.lastStatus}.`,
          );
          return;
        }
        if (command === "last") {
          if (value) {
            notify(ctx, usage);
            return;
          }
          const latest = state.latest;
          const metadata = state.latestMetadata;
          if (!latest || !metadata) {
            notify(ctx, "Intent Bridge: no transformation in this session.");
            return;
          }
          notify(
            ctx,
            formatLastTransformation(
              latest,
              `Status: ${state.lastStatus}; provider=${metadata.providerProfileId}; model=${metadata.model}; mode=${metadata.mode}; latency=${metadata.latencyMs === undefined ? "unknown" : `${metadata.latencyMs}ms`}; rating=${state.rating ?? "none"}; timestamp=${latest.timestamp}.`,
            ),
          );
          return;
        }
        if (command === "rate") {
          if (value !== "good" && value !== "bad") {
            notify(ctx, usage);
            return;
          }
          const latest = state.latest;
          const metadata = state.latestMetadata;
          if (!latest || !metadata) {
            notify(ctx, "Intent Bridge: no transformation to rate.");
            return;
          }
          const timestamp = now().toISOString();
          const ratingTrace: BridgeTraceV1 = {
            version: 1,
            traceId: latest.traceId,
            timestamp,
            mode: metadata.mode,
            status: "success",
            userRating: value,
            providerProfile: metadata.providerProfileId,
            model: metadata.model,
          };
          let saved = true;
          try {
            await append(ratingTrace, config.logging);
          } catch {
            saved = false;
          }
          try {
            pi.appendEntry("intent-bridge.rating", {
              traceId: latest.traceId,
              rating: value,
              timestamp,
              provider: metadata.providerProfileId,
              model: metadata.model,
              mode: metadata.mode,
            });
          } catch {
            saved = false;
          }
          state.rating = value;
          notify(
            ctx,
            saved
              ? "Intent Bridge rating saved."
              : "Intent Bridge rating recorded for this session.",
          );
          return;
        }
        if (command === "logs") {
          if (value) {
            notify(ctx, usage);
            return;
          }
          const warning = fullLoggingWarning(config.logging);
          notify(
            ctx,
            redactSecrets(
              `Logs: mode=${config.logging.mode}; retention=${config.logging.retentionDays} days; path=${join(dirname(resolveConfigPaths({ environment }).globalPath), "logs")}.${warning ? ` ${warning}` : ""}`,
            ).text,
          );
          return;
        }
        if (command === "privacy") {
          if (value) {
            notify(ctx, usage);
            return;
          }
          const collected = await collectContext({
            cwd: ctx.cwd,
            config: config.context,
            projectTrusted: ctx.isProjectTrusted(),
            configDirName: CONFIG_DIR_NAME,
          });
          const entries = collected.manifest.entries;
          const listed = (included: boolean) =>
            entries
              .filter((entry) => entry.included === included)
              .slice(0, 20)
              .map((entry) =>
                included
                  ? entry.path
                  : `${entry.path}${entry.reason ? ` (${entry.reason})` : ""}`,
              )
              .join(", ") || "none";
          const warning = fullLoggingWarning(config.logging);
          notify(
            ctx,
            redactSecrets(
              `Privacy: context=${config.context.enabled ? "enabled" : "disabled"}; trusted=${ctx.isProjectTrusted()}; included=${entries.filter((entry) => entry.included).length}; excluded=${entries.filter((entry) => !entry.included).length}; chars=${collected.manifest.totalCharacters}; included paths=${listed(true)}; excluded paths=${listed(false)}.${warning ? ` ${warning}` : ""}`,
            ).text,
          );
          return;
        }
        if (command === "preview" && value === "off") {
          await save({ enabled: true, mode: "auto" });
          notify(ctx, "Intent Bridge preview disabled.");
          return;
        }
        if (["on", "off", "auto", "preview"].includes(command)) {
          if (value) {
            notify(ctx, usage);
            return;
          }
          let selectedModel = false;
          if (command === "on") {
            const effective = activeProfile(config, await piSelection());
            let ready =
              effective.source === "profile" && Boolean(effective.profile);
            if (effective.source === "pi") {
              await ctx.modelRegistry.refresh();
              ready = compatiblePiModels(
                ctx.modelRegistry.getAvailable() as PiModel[],
              ).some(
                (model) =>
                  model.provider === effective.selection.provider &&
                  model.id === effective.selection.model,
              );
            }
            if (!ready) {
              selectedModel = await selectPiModel();
              if (!selectedModel) return;
            }
          }
          await save({
            enabled: command !== "off",
            mode:
              command === "off"
                ? "off"
                : command === "preview"
                  ? "preview"
                  : "auto",
          });
          if (!selectedModel)
            notify(
              ctx,
              `Intent Bridge ${command === "off" ? "disabled" : "enabled"}.`,
            );
          return;
        }
        if (command === "model") {
          await selectPiModel(value);
          return;
        }
        const effective = activeProfile(config, await piSelection());
        const profile =
          effective.source === "profile" ? effective.profile : undefined;
        if (value) {
          notify(ctx, usage);
          return;
        }
        const started = Date.now();
        try {
          const model =
            effective.source === "pi"
              ? resolvePiModel(
                  ctx.modelRegistry as unknown as PiModelRegistry,
                  effective.selection.provider,
                  effective.selection.model,
                )
              : undefined;
          if (!model && !profile)
            throw new BridgeError({
              code: "CONFIG_MISSING",
              safeMessage: "Missing profile.",
              retryable: false,
            });
          const health = await (model
            ? createPiNativeProvider(
                ctx.modelRegistry as unknown as PiModelRegistry,
                model,
              )
            : createProvider(requireProfile(profile))
          ).testConnection({
            ...(ctx.signal ? { signal: ctx.signal } : {}),
          });
          notify(
            ctx,
            `Intent Bridge test: ok; model=${model?.id ?? requireProfile(profile).model}; latency=${Math.max(0, health.latencyMs ?? Date.now() - started)}ms.`,
          );
        } catch (error) {
          notify(
            ctx,
            `Intent Bridge test: failed (${errorCode(error)}); model=${effective.source === "pi" ? effective.selection.model : (profile?.model ?? "none")}.`,
          );
        }
      } catch {
        notify(ctx, "Intent Bridge settings could not be updated.");
      }
    },
  });
}
export default function intentBridgeExtension(pi: ExtensionAPI): void {
  createIntentBridgeExtension(pi);
}
