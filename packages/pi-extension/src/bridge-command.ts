import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CONFIG_DIR_NAME,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  BridgeError,
  fullLoggingWarning,
  loadBridgeConfigLayer,
  redactSecrets,
  resolveConfigPaths,
  updateBridgeConfigLayerAtomic,
} from "@intent-bridge/core";

import { formatLastTransformation } from "./preview.js";
import type { createProviderResolver } from "./provider-resolution.js";
import type { createTransformationController } from "./transformation-controller.js";

type Config = Awaited<
  ReturnType<typeof import("@intent-bridge/core").loadLayeredConfig>
>;
type Resolver = ReturnType<typeof createProviderResolver>;
type Controller = ReturnType<typeof createTransformationController>;
const usage =
  "Usage: /bridge on|off|model [provider/model-id|model-id]|auto|preview [off]|status|test|last|rate good|bad|logs|privacy";
const items = [
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
function notify(ctx: ExtensionCommandContext, message: string): void {
  ctx.ui.notify(message, "info");
}
function errorCode(error: unknown): string {
  return error instanceof BridgeError ? error.code : "CONFIG_INVALID";
}

export interface BridgeCommandDependencies {
  environment: NodeJS.ProcessEnv;
  getConfig: (ctx: ExtensionCommandContext) => Promise<Config>;
  collectContext: (
    options: Parameters<
      typeof import("@intent-bridge/core").collectProjectContext
    >[0],
  ) => ReturnType<typeof import("@intent-bridge/core").collectProjectContext>;
  updateConfig?: typeof updateBridgeConfigLayerAtomic;
  resolver: Resolver;
  controller: Controller;
}

export function createBridgeCommand(dependencies: BridgeCommandDependencies) {
  const updateConfig =
    dependencies.updateConfig ?? updateBridgeConfigLayerAtomic;
  return {
    description: "Manage Intent Bridge settings",
    getArgumentCompletions: (prefix: string) => {
      const normalized = prefix.trimStart().toLowerCase();
      const matches = items.filter(({ value }) => value.startsWith(normalized));
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
      if (command === "off" && !value) dependencies.controller.clearPending();
      try {
        const config = await dependencies.getConfig(ctx);
        const paths = resolveConfigPaths({
          projectRoot: ctx.cwd,
          configDirName: CONFIG_DIR_NAME,
          environment: dependencies.environment,
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
        const selectPiModel = async (requested?: string) => {
          const result = await dependencies.resolver.selectModel(
            ctx.modelRegistry as never,
            requested,
            ctx.hasUI
              ? (choices) =>
                  ctx.ui.select("Select Intent Bridge model", [...choices])
              : undefined,
            ctx.signal,
          );
          if (result.kind === "no-compatible")
            notify(ctx, "No compatible Pi models are available.");
          else if (result.kind === "cancelled")
            notify(ctx, "Intent Bridge model selection cancelled.");
          else if (result.kind === "unavailable")
            notify(
              ctx,
              "That model is not available. Use /bridge model to choose one.",
            );
          else if (result.kind === "failed")
            notify(
              ctx,
              `Intent Bridge could not use that model.${result.hadPrevious ? " The previous selection was kept." : ""} Try /bridge model again.`,
            );
          else notify(ctx, `Intent Bridge is ready with ${result.model.name}.`);
          return result.kind === "selected";
        };
        if (command === "status") {
          if (value) {
            notify(ctx, usage);
            return;
          }
          const effective = await dependencies.resolver.active(config);
          const model =
            effective.source === "pi"
              ? effective.selection.model
              : (effective.profile?.model ?? "none");
          notify(
            ctx,
            `Intent Bridge: enabled=${config.enabled}; mode=${config.mode}; model=${model}; context=${config.context.enabled ? (ctx.isProjectTrusted() ? "enabled/trusted" : "enabled/untrusted") : "disabled"}; logging=${config.logging.mode}; last=${dependencies.controller.session().lastStatus}.`,
          );
          return;
        }
        if (command === "last") {
          if (value) {
            notify(ctx, usage);
            return;
          }
          const state = dependencies.controller.session();
          if (!state.latest || !state.latestMetadata) {
            notify(ctx, "Intent Bridge: no transformation in this session.");
            return;
          }
          const metadata = state.latestMetadata;
          notify(
            ctx,
            formatLastTransformation(
              state.latest,
              `Status: ${state.lastStatus}; provider=${metadata.providerProfileId}; model=${metadata.model}; mode=${metadata.mode}; latency=${metadata.latencyMs === undefined ? "unknown" : `${metadata.latencyMs}ms`}; rating=${state.rating ?? "none"}; includeOriginalRequest=${config.compiler.includeOriginalRequest}; timestamp=${state.latest.timestamp}.`,
            ),
          );
          return;
        }
        if (command === "rate") {
          if (value !== "good" && value !== "bad") {
            notify(ctx, usage);
            return;
          }
          const state = dependencies.controller.session();
          if (!state.latest || !state.latestMetadata) {
            notify(ctx, "Intent Bridge: no transformation to rate.");
            return;
          }
          const saved = await dependencies.controller.rate(value, config);
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
              `Logs: mode=${config.logging.mode}; retention=${config.logging.retentionDays} days; path=${join(dirname(resolveConfigPaths({ environment: dependencies.environment }).globalPath), "logs")}.${warning ? ` ${warning}` : ""}`,
            ).text,
          );
          return;
        }
        if (command === "privacy") {
          if (value) {
            notify(ctx, usage);
            return;
          }
          const collected = await dependencies.collectContext({
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
            const effective = await dependencies.resolver.active(config);
            let ready =
              effective.source === "profile" && Boolean(effective.profile);
            if (effective.source === "pi")
              ready = await dependencies.resolver.isSelectedModelAvailable(
                ctx.modelRegistry as never,
                effective.selection,
              );
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
        const effective = await dependencies.resolver.active(config);
        if (value) {
          notify(ctx, usage);
          return;
        }
        const started = Date.now();
        try {
          const resolved = await dependencies.resolver.resolve(
            config,
            ctx.modelRegistry as never,
          );
          const health = await resolved.provider.testConnection({
            ...(ctx.signal ? { signal: ctx.signal } : {}),
          });
          notify(
            ctx,
            `Intent Bridge test: ok; model=${resolved.model}; latency=${Math.max(0, health.latencyMs ?? Date.now() - started)}ms.`,
          );
        } catch (error) {
          notify(
            ctx,
            `Intent Bridge test: failed (${errorCode(error)}); model=${effective.source === "pi" ? effective.selection.model : (effective.profile?.model ?? "none")}.`,
          );
        }
      } catch {
        notify(ctx, "Intent Bridge settings could not be updated.");
      }
    },
  };
}
