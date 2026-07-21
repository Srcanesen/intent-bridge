import {
  type BridgeTraceV1,
  collectProjectContext,
  InterpretationPipeline,
  type JsonlTraceWriter,
  PiCompilerV1,
  type TraceSink,
} from "@intent-bridge/core";
import {
  CONFIG_DIR_NAME,
  type ExtensionAPI,
  type ExtensionContext,
  type InputEvent,
} from "@earendil-works/pi-coding-agent";

import { PendingTaskQueue } from "./pending-task-queue.js";
import { formatTransformation, PREVIEW_CHOICES } from "./preview.js";
import type { createProviderResolver } from "./provider-resolution.js";
import { eligibility, messageType } from "./routing.js";

type Config = Awaited<
  ReturnType<typeof import("@intent-bridge/core").loadLayeredConfig>
>;
type Resolver = ReturnType<typeof createProviderResolver>;

class BufferedTraceSink implements TraceSink {
  trace?: BridgeTraceV1;
  async append(trace: BridgeTraceV1): Promise<void> {
    this.trace = trace;
  }
}

type DeliveryDecision = "inject" | "preview" | "review_required_no_ui";
function decideDelivery(
  mode: Config["mode"],
  assessment: { outcome: "accept" | "review" },
  enforcement: "observe" | "review",
  hasUI: boolean,
): DeliveryDecision {
  if (mode === "preview") return "preview";
  if (
    mode === "auto" &&
    enforcement === "review" &&
    assessment.outcome === "review"
  )
    return hasUI ? "preview" : "review_required_no_ui";
  return "inject";
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
function notify(ctx: ExtensionContext, message: string): void {
  ctx.ui.notify(message, "info");
}

export interface TransformationControllerDependencies {
  pi: ExtensionAPI;
  getConfig: (ctx: ExtensionContext) => Promise<Config>;
  collectContext?: typeof collectProjectContext;
  resolver: Resolver;
  traceWriter: JsonlTraceWriter;
  uuid: () => string;
  now: () => Date;
}

export function createTransformationController(
  dependencies: TransformationControllerDependencies,
) {
  const { pi, getConfig, resolver, traceWriter, uuid, now } = dependencies;
  const collectContext = dependencies.collectContext ?? collectProjectContext;
  let lastStatus: "none" | "transformed" | "fail_open" | "bypass" = "none";
  let latest: ReturnType<InterpretationPipeline["getLatest"]>;
  let latestMetadata:
    | {
        providerProfileId: string;
        model: string;
        mode: "auto" | "preview" | "off";
        latencyMs?: number;
      }
    | undefined;
  let rating: "good" | "bad" | undefined;
  const pendingTasks = new PendingTaskQueue({
    now: () => now().getTime(),
    diagnostic: (payload) => {
      try {
        pi.appendEntry("intent-bridge.queue", payload);
      } catch {}
    },
  });
  const append = async (trace: BridgeTraceV1, logging: Config["logging"]) =>
    traceWriter.append(trace, logging).catch(() => undefined);
  const session = () =>
    Object.freeze({ lastStatus, latest, latestMetadata, rating });
  const setLatest = (
    value: NonNullable<typeof latest>,
    metadata: NonNullable<typeof latestMetadata>,
  ) => {
    latest = value;
    latestMetadata = metadata;
    rating = undefined;
  };
  const handleInput = async (
    event: InputEvent,
    ctx: ExtensionContext,
  ): Promise<{ action: "continue" } | { action: "handled" }> => {
    const syntax = eligibility(event);
    if (
      !syntax.eligible &&
      syntax.reason !== "disabled" &&
      syntax.reason !== "mode"
    )
      return { action: "continue" as const };
    const traceId = uuid();
    const reservation = pendingTasks.reserve(
      event.text,
      event.images?.length ?? 0,
      traceId,
    );
    let reserved = true;
    const approve = (content: string) => {
      if (!pendingTasks.markReady(reservation, content)) return false;
      reserved = false;
      return true;
    };
    try {
      const config = await getConfig(ctx);
      if (!eligibility(event, config).eligible)
        return { action: "continue" as const };
      const source: "interactive" | "rpc" =
        event.source === "rpc" ? "rpc" : "interactive";
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
        lastStatus = "bypass";
        return { action: "continue" as const };
      }
      const resolved = await resolver.resolve(
        config,
        ctx.modelRegistry as never,
      );
      const context = await collectContext({
        cwd: ctx.cwd,
        config: config.context,
        projectTrusted: ctx.isProjectTrusted(),
        configDirName: CONFIG_DIR_NAME,
      });
      const buffered = new BufferedTraceSink();
      const pipeline = new InterpretationPipeline(
        resolved.provider,
        new PiCompilerV1(config.compiler),
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
          quality: config.quality,
          providerProfileId: resolved.providerProfileId,
          model: resolved.model,
          ...(resolved.pricing ? { pricing: resolved.pricing } : {}),
          promptVersion: resolved.promptVersion,
          retryPolicy: config.retry,
          contextManifest: context.manifest,
          projectId: ctx.cwd,
          sessionId: ctx.sessionManager.getSessionId(),
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        },
      );
      if (result.status !== "transformed") {
        if (buffered.trace) await append(buffered.trace, config.logging);
        lastStatus = "fail_open";
        notify(
          ctx,
          "Intent Bridge skipped this message; the original was sent unchanged.",
        );
        return { action: "continue" as const };
      }
      const transformation = pipeline.getLatest();
      if (!transformation) throw new Error("Missing latest transformation.");
      setLatest(transformation, {
        providerProfileId: resolved.providerProfileId,
        model: resolved.model,
        mode: config.mode,
        ...(buffered.trace?.latencyMs === undefined
          ? {}
          : { latencyMs: buffered.trace.latencyMs }),
      });
      const decision = decideDelivery(
        config.mode,
        result.assessment,
        config.quality.enforcement,
        ctx.hasUI,
      );
      if (decision === "review_required_no_ui") {
        if (buffered.trace) {
          buffered.trace.status = "bypass";
          buffered.trace.bypassReason = "quality_review_required_no_ui";
        }
        if (buffered.trace) await append(buffered.trace, config.logging);
        try {
          pi.appendEntry("intent-bridge.preview", {
            traceId,
            action: "review_required_no_ui",
            timestamp: now().toISOString(),
          });
        } catch {}
        lastStatus = "bypass";
        return { action: "continue" as const };
      }
      if (decision === "inject") {
        if (buffered.trace) await append(buffered.trace, config.logging);
        if (!approve(result.compiledTask)) {
          lastStatus = "fail_open";
          notify(
            ctx,
            "Intent Bridge skipped this message; the original was sent unchanged.",
          );
          return { action: "continue" as const };
        }
        lastStatus = "transformed";
        return { action: "continue" as const };
      }
      let choice: string | undefined;
      try {
        choice = await ctx.ui.select(
          formatTransformation(transformation, config.compiler),
          [...PREVIEW_CHOICES],
        );
      } catch {
        choice = undefined;
        if (buffered.trace) {
          buffered.trace.status = "bypass";
          buffered.trace.bypassReason = "preview_ui_failed";
        }
        if (buffered.trace) await append(buffered.trace, config.logging);
        lastStatus = "bypass";
        return { action: "continue" as const };
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
      lastStatus = action === "transform" ? "transformed" : "bypass";
      if (action === "transform") {
        if (!approve(result.compiledTask)) {
          lastStatus = "fail_open";
          notify(
            ctx,
            "Intent Bridge skipped this message; the original was sent unchanged.",
          );
        }
        return { action: "continue" as const };
      }
      if (action === "handled") {
        pendingTasks.cancel(reservation);
        reserved = false;
      }
      return action === "continue"
        ? { action: "continue" }
        : { action: "handled" };
    } catch {
      lastStatus = "fail_open";
      notify(
        ctx,
        "Intent Bridge skipped this message; the original was sent unchanged.",
      );
      return { action: "continue" as const };
    } finally {
      if (reserved) pendingTasks.skip(reservation);
    }
  };
  return {
    handleInput,
    beforeAgentStart: (event: { prompt: string; images?: unknown[] }) => {
      const content = pendingTasks.consumeForAgentStart(
        event.prompt,
        event.images?.length ?? 0,
        now().getTime(),
      );
      return content === null
        ? undefined
        : {
            message: {
              customType: "intent-bridge.task",
              content,
              display: false,
            },
          };
    },
    sessionStart: async (ctx: ExtensionContext) => {
      pendingTasks.clear();
      try {
        const config = await getConfig(ctx);
        await traceWriter
          .prune(config.logging.retentionDays)
          .catch(() => undefined);
      } catch {}
    },
    clearPending: () => pendingTasks.clear(),
    shutdown: () => {
      pendingTasks.clear();
      latest = undefined;
      latestMetadata = undefined;
      rating = undefined;
      lastStatus = "none";
    },
    session,
    rate: async (value: "good" | "bad", config: Config) => {
      if (!latest || !latestMetadata) return undefined;
      const timestamp = now().toISOString();
      const trace: BridgeTraceV1 = {
        version: 1,
        traceId: latest.traceId,
        timestamp,
        mode: latestMetadata.mode,
        status: "success",
        userRating: value,
        providerProfile: latestMetadata.providerProfileId,
        model: latestMetadata.model,
      };
      let saved = true;
      try {
        await append(trace, config.logging);
      } catch {
        saved = false;
      }
      try {
        pi.appendEntry("intent-bridge.rating", {
          traceId: latest.traceId,
          rating: value,
          timestamp,
          provider: latestMetadata.providerProfileId,
          model: latestMetadata.model,
          mode: latestMetadata.mode,
        });
      } catch {
        saved = false;
      }
      rating = value;
      return saved;
    },
  };
}
