export const BRIDGE_ERROR_CODES = [
  "CONFIG_MISSING",
  "CONFIG_INVALID",
  "SECRET_MISSING",
  "PROVIDER_AUTH",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNREACHABLE",
  "PROVIDER_SERVER",
  "PROVIDER_RESPONSE_TOO_LARGE",
  "PROVIDER_INVALID_JSON",
  "INTENT_SCHEMA_INVALID",
  "CONTEXT_READ_FAILED",
  "CONTEXT_REDACTION_FAILED",
  "COMPILER_FAILED",
  "PREVIEW_UNAVAILABLE",
  "TRACE_WRITE_FAILED",
  "PI_EVENT_UNSUPPORTED",
] as const;

export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[number];

export interface BridgeErrorOptions {
  code: BridgeErrorCode;
  safeMessage: string;
  retryable: boolean;
  cause?: unknown;
}

export class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  readonly safeMessage: string;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor({ code, safeMessage, retryable, cause }: BridgeErrorOptions) {
    super(safeMessage);
    this.name = "BridgeError";
    this.code = code;
    this.safeMessage = safeMessage;
    this.retryable = retryable;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}
