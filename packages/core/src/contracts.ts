export type BridgeMessageType = "initial" | "normal" | "steer" | "follow_up";

export type { TransformationAssessment } from "./quality-policy.js";

export interface ProjectContext {
  name?: string;
  summary?: string;
  instructionExcerpts: string[];
}

export interface BridgeInput {
  traceId: string;
  receivedAt: string;
  harness: "pi";
  messageType: BridgeMessageType;
  source: "interactive" | "rpc";
  originalText: string;
  attachmentSummary: {
    imageCount: number;
  };
  project: ProjectContext;
}

export interface InterpretationRequest {
  schemaVersion: "1";
  originalText: string;
  messageType: BridgeMessageType;
  attachmentSummary: {
    imageCount: number;
  };
  projectContext: ProjectContext;
  outputRequirements: {
    contentLanguage: "en";
    preserveResponseLanguage: true;
    strictSchema: true;
    implementationCodeForbidden: true;
  };
}

export interface ProviderCallOptions {
  signal?: AbortSignal;
}

export interface RetryPolicyV1 {
  maxRetries: number;
  baseDelayMs: number;
  totalBudgetMs: number;
}

export interface ProviderHealthResult {
  ok: true;
  latencyMs: number;
  requestId?: string;
  model?: string;
}

export interface OpenAICompatibleCapabilities {
  structuredOutput: "json_schema" | "json_object" | "prompt_only";
  usageMetadata: boolean;
  supportsSeed: boolean;
}

export interface ProviderProfileV1 {
  id: string;
  protocol: "openai-compatible";
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  timeoutMs: number;
  maxOutputTokens: number;
  temperature?: number;
  capabilities: OpenAICompatibleCapabilities;
  headers?: Record<string, string>;
  pricing?: {
    currency: "USD";
    inputPerMillion?: number;
    outputPerMillion?: number;
  };
}

export interface ProviderInterpretationResult {
  intent: import("./intent.js").IntentDocumentV1;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  requestId?: string;
  rawResponseHash: string;
  latencyMs: number;
}

export interface IntentProvider {
  readonly id: string;
  interpret(
    request: InterpretationRequest,
    options: ProviderCallOptions,
  ): Promise<ProviderInterpretationResult>;
  testConnection(options: ProviderCallOptions): Promise<ProviderHealthResult>;
}

export interface CompiledTask {
  compilerVersion: "pi-v1";
  text: string;
  responseLanguageCode: string;
}

export interface HarnessCompiler<TIntent> {
  compile(input: {
    intent: TIntent;
    originalText: string;
    attachmentSummary: { imageCount: number };
  }): CompiledTask;
}

export interface FullTraceContentV1 {
  originalText?: string;
  intent?: import("./intent.js").IntentDocumentV1;
  compiledTask?: CompiledTask;
  contextManifest?: unknown;
}

export interface BridgeTraceV1 {
  version: 1;
  traceId: string;
  timestamp: string;
  projectIdHash?: string;
  sessionIdHash?: string;
  messageType?: BridgeMessageType;
  sourceLanguage?: string;
  providerProfile?: string;
  model?: string;
  mode: "auto" | "preview" | "off";
  status: "success" | "failure" | "bypass";
  bypassReason?: string;
  errorCode?: string;
  latencyMs?: number;
  tokenUsage?: {
    input?: number;
    output?: number;
    total?: number;
  };
  estimatedCostUsd?: number;
  schemaVersion?: string;
  compilerVersion?: string;
  promptVersion?: string;
  quality?: QualitySignalsV1;
  assessment?: import("./quality-policy.js").TransformationAssessment;
  userRating?: "good" | "bad";
  content?: FullTraceContentV1;
}

export interface QualitySignalsV1 {
  schemaValid: boolean;
  languagePresent: boolean;
  taskCount: number;
  hasGoal: boolean;
  constraintsSeparated: boolean;
  assumptionsSeparated: boolean;
  ambiguitiesTyped: boolean;
  compilerValid: boolean;
  providerConfidence?: number;
  estimatedScore?: number;
}
