import { createHash } from "node:crypto";

import type { LoggingConfigV1, QualityConfigV1 } from "./config.js";
import type {
  BridgeInput,
  BridgeTraceV1,
  CompiledTask,
  HarnessCompiler,
  IntentProvider,
  InterpretationRequest,
  ProviderInterpretationResult,
  QualitySignalsV1,
  RetryPolicyV1,
} from "./contracts.js";
import { BridgeError, type BridgeErrorCode } from "./errors.js";
import type { IntentDocument } from "./intent.js";
import { parseIntentDocument } from "./intent.js";
import { calculateQualitySignals } from "./quality.js";
import {
  DEFAULT_QUALITY_CONFIG,
  assessQuality,
  type TransformationAssessment,
} from "./quality-policy.js";

export type PipelineResult =
  | {
      status: "transformed";
      compiledTask: string;
      intent: IntentDocument;
      assessment: TransformationAssessment;
      traceId: string;
    }
  | {
      status: "fail_open";
      originalText: string;
      errorCode: BridgeErrorCode | string;
      traceId: string;
    };

export interface TraceSink {
  append(
    trace: BridgeTraceV1,
    logging: Pick<LoggingConfigV1, "mode">,
  ): Promise<void>;
}

export interface PipelineRunOptions {
  mode: "auto" | "preview" | "off";
  logging: LoggingConfigV1;
  quality?: QualityConfigV1;
  providerProfileId: string;
  model: string;
  pricing?: { inputPerMillion?: number; outputPerMillion?: number };
  promptVersion?: string;
  contextManifest?: unknown;
  projectId?: string;
  sessionId?: string;
  signal?: AbortSignal;
  retryPolicy?: RetryPolicyV1;
}

export interface FullInMemoryTransformation {
  originalText: string;
  intent: IntentDocument;
  compiledTask: CompiledTask;
  quality: QualitySignalsV1;
  assessment: TransformationAssessment;
  qualityConfig: QualityConfigV1;
  traceId: string;
  timestamp: string;
  contextManifest?: unknown;
}

export interface SessionBridgeState {
  lastTransformation?: FullInMemoryTransformation;
}

function hash(value: string | undefined): string | undefined {
  return value === undefined
    ? undefined
    : createHash("sha256").update(value).digest("hex");
}

export function estimateCostUsd(
  usage: ProviderInterpretationResult["usage"],
  pricing: PipelineRunOptions["pricing"],
): number | undefined {
  if (!usage || !pricing) return undefined;
  const input = usage.inputTokens;
  const output = usage.outputTokens;
  if (
    (input === undefined && output === undefined) ||
    (input !== undefined && pricing.inputPerMillion === undefined) ||
    (output !== undefined && pricing.outputPerMillion === undefined)
  )
    return undefined;
  const cost =
    ((input ?? 0) * (pricing.inputPerMillion ?? 0)) / 1_000_000 +
    ((output ?? 0) * (pricing.outputPerMillion ?? 0)) / 1_000_000;
  return Number.isFinite(cost) ? cost : undefined;
}

// Guard: reject intent with leaked interpreter-only no-code constraints
// when the source does not explicitly request no code.
const LEAKED_NO_CODE_RE =
  /\b(?:no\s+implementation\s+code|do\s+not\s+write\s+implementation\s+code)\b/i;

const USER_EN_NO_CODE_RE =
  /\b(?:no\s+code|do\s+not\s+(?:write|implement|generate)\s+(?:code|implementation)|don['’]t\s+(?:write|implement|generate)\s+(?:code|implementation))\b/i;

const USER_TR_NO_CODE_RE =
  /\b(?:kod\s+yazma|uygulama\s+kodu\s+yazma|kod\s+istemiyorum|kod\s+yazmadan)\b/i;

function sourceRequestsNoCode(sourceTexts: string[]): boolean {
  return sourceTexts.some(
    (t) => USER_EN_NO_CODE_RE.test(t) || USER_TR_NO_CODE_RE.test(t),
  );
}

function hasLeakedNoCodeConstraint(intent: IntentDocument): boolean {
  return [
    ...intent.globalConstraints,
    ...intent.tasks.flatMap((t) => t.constraints),
  ].some((c) => LEAKED_NO_CODE_RE.test(c));
}

function guardNoCodeLeak(intent: IntentDocument, input: BridgeInput): void {
  if (!hasLeakedNoCodeConstraint(intent)) return;
  const sourceTexts: string[] = [
    input.originalText,
    ...(input.project.summary ? [input.project.summary] : []),
    ...input.project.instructionExcerpts,
  ];
  if (sourceRequestsNoCode(sourceTexts)) return;
  throw new BridgeError({
    code: "INTENT_SCHEMA_INVALID",
    safeMessage:
      "Intent contains interpreter-only instructions as user constraints.",
    retryable: false,
  });
}

function requestFrom(input: BridgeInput): InterpretationRequest {
  return {
    schemaVersion: "2",
    originalText: input.originalText,
    messageType: input.messageType,
    attachmentSummary: input.attachmentSummary,
    projectContext: input.project,
    outputRequirements: {
      contentLanguage: "en",
      preserveResponseLanguage: true,
      strictSchema: true,
      implementationCodeForbidden: true,
    },
  };
}

function errorCode(error: unknown): BridgeErrorCode {
  return error instanceof BridgeError ? error.code : "PROVIDER_UNREACHABLE";
}

const RETRYABLE_PROVIDER_CODES = new Set<BridgeErrorCode>([
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNREACHABLE",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_SERVER",
]);

function retryableProviderError(error: unknown): error is BridgeError {
  return (
    error instanceof BridgeError &&
    error.retryable &&
    RETRYABLE_PROVIDER_CODES.has(error.code)
  );
}

function abortedError(deadline: boolean): BridgeError {
  return new BridgeError({
    code: deadline ? "PROVIDER_TIMEOUT" : "PROVIDER_UNREACHABLE",
    safeMessage: "The provider request could not be completed.",
    retryable: true,
  });
}

async function waitForRetry(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(done, delayMs);
    const abort = () => done(abortedError(false));
    function done(error?: BridgeError) {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    }
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function explicitlyRequestsResponseLanguage(intent: IntentDocument): boolean {
  return [
    ...intent.globalConstraints,
    ...intent.tasks.flatMap((task) => task.constraints),
  ].some((constraint) =>
    /\b(?:answer|respond|reply|explain|final response)\b[\s\S]{0,80}\b(?:in|using)\s+(?:[a-z]{2,3}|[a-z]+(?:\s+[a-z]+)?)\b/i.test(
      constraint,
    ),
  );
}

function preserveResponseLanguage(intent: IntentDocument): IntentDocument {
  if (intent.schemaVersion === "2") {
    if (intent.responseLanguage.source === "user_explicit") return intent;
    return {
      ...intent,
      responseLanguage: {
        code: intent.sourceLanguage.code,
        ...(intent.sourceLanguage.name === undefined
          ? {}
          : { name: intent.sourceLanguage.name }),
        source: "source_language_default",
      },
    };
  }
  if (
    intent.sourceLanguage.code === intent.responseLanguage.code ||
    explicitlyRequestsResponseLanguage(intent)
  )
    return intent;
  return {
    ...intent,
    responseLanguage: {
      code: intent.sourceLanguage.code,
      ...(intent.sourceLanguage.name === undefined
        ? {}
        : { name: intent.sourceLanguage.name }),
    },
  };
}

export class InterpretationPipeline {
  readonly state: SessionBridgeState = {};

  constructor(
    private readonly provider: IntentProvider,
    private readonly compiler: HarnessCompiler<IntentDocument>,
    private readonly traceSink?: TraceSink,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getLatest(): FullInMemoryTransformation | undefined {
    return this.state.lastTransformation;
  }

  async run(
    input: BridgeInput,
    options: PipelineRunOptions,
  ): Promise<PipelineResult> {
    const timestamp = this.now().toISOString();
    try {
      const providerResult = await this.interpret(requestFrom(input), options);
      const intent = preserveResponseLanguage(
        parseIntentDocument(providerResult.intent, {
          expectedMessageType: input.messageType,
        }).intent,
      );
      guardNoCodeLeak(intent, input);
      const qualityConfig = options.quality ?? DEFAULT_QUALITY_CONFIG;
      const assessment = assessQuality(intent, qualityConfig);
      let compiledTask: CompiledTask;
      try {
        compiledTask = this.compiler.compile({
          intent,
          originalText: input.originalText,
          attachmentSummary: input.attachmentSummary,
          assessment,
        });
      } catch (cause) {
        throw new BridgeError({
          code: "COMPILER_FAILED",
          safeMessage: "The intent could not be compiled safely.",
          retryable: false,
          cause,
        });
      }
      const quality = calculateQualitySignals(intent, { compilerValid: true });
      this.state.lastTransformation = {
        originalText: input.originalText,
        intent,
        compiledTask,
        quality,
        assessment,
        qualityConfig,
        traceId: input.traceId,
        timestamp,
        ...(options.contextManifest === undefined
          ? {}
          : { contextManifest: options.contextManifest }),
      };
      await this.appendTrace(
        this.successTrace(
          input,
          options,
          timestamp,
          providerResult,
          intent,
          compiledTask,
          quality,
          assessment,
        ),
        options.logging,
      );
      return {
        status: "transformed",
        compiledTask: compiledTask.text,
        intent,
        assessment,
        traceId: input.traceId,
      };
    } catch (error) {
      const code = errorCode(error);
      await this.appendTrace(
        this.failureTrace(input, options, timestamp, code),
        options.logging,
      );
      return {
        status: "fail_open",
        originalText: input.originalText,
        errorCode: code,
        traceId: input.traceId,
      };
    }
  }

  private async interpret(
    request: InterpretationRequest,
    options: PipelineRunOptions,
  ): Promise<ProviderInterpretationResult> {
    if (!options.retryPolicy)
      return this.provider.interpret(request, {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    const policy = options.retryPolicy;
    const maxRetries = Math.min(Math.max(0, policy.maxRetries), 2);
    const deadline = Date.now() + policy.totalBudgetMs;
    let lastError: BridgeError | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const remaining = deadline - Date.now();
      if (options.signal?.aborted || remaining <= 0)
        throw lastError ?? abortedError(remaining <= 0);
      const controller = new AbortController();
      let deadlineAborted = false;
      const abort = () => controller.abort();
      const timeout = setTimeout(() => {
        deadlineAborted = true;
        controller.abort();
      }, remaining);
      let rejectAbort!: (error: BridgeError) => void;
      const onControllerAbort = () =>
        rejectAbort(abortedError(deadlineAborted));
      const abortPromise = new Promise<never>((_, reject) => {
        rejectAbort = reject;
        if (controller.signal.aborted) onControllerAbort();
        else
          controller.signal.addEventListener("abort", onControllerAbort, {
            once: true,
          });
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      try {
        const providerCall = this.provider.interpret(request, {
          signal: controller.signal,
        });
        void providerCall.catch((error: unknown) => {
          if (error instanceof BridgeError) lastError = error;
        });
        return await Promise.race([providerCall, abortPromise]);
      } catch (error) {
        if (error instanceof BridgeError) lastError = error;
        if (
          options.signal?.aborted ||
          deadlineAborted ||
          Date.now() >= deadline ||
          !retryableProviderError(error) ||
          attempt === maxRetries
        )
          throw lastError ?? error;
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener("abort", onControllerAbort);
        options.signal?.removeEventListener("abort", abort);
      }
      const delay = Math.floor(
        Math.random() * policy.baseDelayMs * 2 ** attempt,
      );
      const remainingAfterFailure = deadline - Date.now();
      if (options.signal?.aborted || delay >= remainingAfterFailure)
        throw lastError ?? abortedError(remainingAfterFailure <= 0);
      try {
        await waitForRetry(delay, options.signal);
      } catch (error) {
        throw lastError ?? error;
      }
    }
    throw lastError ?? abortedError(false);
  }

  private async appendTrace(
    trace: BridgeTraceV1,
    logging: LoggingConfigV1,
  ): Promise<void> {
    await this.traceSink?.append(trace, logging).catch(() => undefined);
  }

  private baseTrace(
    input: BridgeInput,
    options: PipelineRunOptions,
    timestamp: string,
  ): Omit<BridgeTraceV1, "status"> {
    const projectIdHash = hash(options.projectId);
    const sessionIdHash = hash(options.sessionId);
    return {
      version: 1,
      traceId: input.traceId,
      timestamp,
      ...(projectIdHash === undefined ? {} : { projectIdHash }),
      ...(sessionIdHash === undefined ? {} : { sessionIdHash }),
      messageType: input.messageType,
      providerProfile: options.providerProfileId,
      model: options.model,
      mode: options.mode,
      schemaVersion: "2",
      ...(options.promptVersion === undefined
        ? {}
        : { promptVersion: options.promptVersion }),
    };
  }

  private successTrace(
    input: BridgeInput,
    options: PipelineRunOptions,
    timestamp: string,
    providerResult: ProviderInterpretationResult,
    intent: IntentDocument,
    compiledTask: CompiledTask,
    quality: QualitySignalsV1,
    assessment: TransformationAssessment,
  ): BridgeTraceV1 {
    const usage = providerResult.usage;
    const estimatedCostUsd = estimateCostUsd(usage, options.pricing);
    return {
      ...this.baseTrace(input, options, timestamp),
      schemaVersion: intent.schemaVersion,
      status: "success",
      sourceLanguage: intent.sourceLanguage.code,
      latencyMs: providerResult.latencyMs,
      ...(usage === undefined
        ? {}
        : {
            tokenUsage: {
              ...(usage.inputTokens === undefined
                ? {}
                : { input: usage.inputTokens }),
              ...(usage.outputTokens === undefined
                ? {}
                : { output: usage.outputTokens }),
              ...(usage.totalTokens === undefined
                ? {}
                : { total: usage.totalTokens }),
            },
          }),
      ...(estimatedCostUsd === undefined ? {} : { estimatedCostUsd }),
      compilerVersion: compiledTask.compilerVersion,
      quality,
      assessment,
      content: {
        originalText: input.originalText,
        intent,
        compiledTask,
        ...(options.contextManifest === undefined
          ? {}
          : { contextManifest: options.contextManifest }),
      },
    };
  }

  private failureTrace(
    input: BridgeInput,
    options: PipelineRunOptions,
    timestamp: string,
    code: BridgeErrorCode,
  ): BridgeTraceV1 {
    return {
      ...this.baseTrace(input, options, timestamp),
      status: "failure",
      errorCode: code,
      content: {
        originalText: input.originalText,
        ...(options.contextManifest === undefined
          ? {}
          : { contextManifest: options.contextManifest }),
      },
    };
  }
}
