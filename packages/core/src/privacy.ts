import type { LoggingConfigV1 } from "./config.js";
import type { ContextManifestV1 } from "./context.js";
import type { BridgeTraceV1 } from "./contracts.js";

export const REDACTION_MARKER = "[REDACTED]";
const patterns = [
  /-----BEGIN[\s\S]{0,64}?PRIVATE KEY-----[\s\S]*?-----END[\s\S]{0,64}?PRIVATE KEY-----/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /https?:\/\/([^\s/:@]+):([^\s@]+)@/gi,
  /\b(?:sk|rk|pk)_[A-Za-z0-9_-]{16,}\b/gi,
  /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^\s"']{8,}/gi,
  /\b[A-Za-z0-9+/_-]{32,}={0,2}\b/g,
];
export function redactSecrets(text: string): { text: string; count: number } {
  let count = 0;
  try {
    let result = text;
    for (const pattern of patterns)
      result = result.replace(pattern, () => {
        count++;
        return REDACTION_MARKER;
      });
    return { text: result, count };
  } catch {
    throw new Error("context redaction failed");
  }
}
function sanitize(value: unknown, key = ""): unknown {
  if (typeof value === "string")
    return /(?:authorization|api[_-]?key|token|secret|password|headers?)/i.test(
      key,
    )
      ? REDACTION_MARKER
      : redactSecrets(value).text;
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([name, entry]) => [
        name,
        sanitize(entry, name),
      ]),
    );
  return value;
}
export function projectTrace(
  logging: Pick<LoggingConfigV1, "mode">,
  trace: BridgeTraceV1,
): BridgeTraceV1 | undefined {
  if (logging.mode === "off") return undefined;
  const { content: _content, ...metadata } = trace;
  if (logging.mode === "metadata") return metadata as BridgeTraceV1;
  return sanitize(trace) as BridgeTraceV1;
}
export function fullLoggingWarning(
  logging: Pick<LoggingConfigV1, "mode">,
): string | undefined {
  return logging.mode === "full"
    ? "Full logging stores sanitized request and context content locally."
    : undefined;
}
export function privacyPreview(input: {
  enabled: boolean;
  manifest: ContextManifestV1;
  logging: Pick<LoggingConfigV1, "mode">;
}): {
  enabled: boolean;
  eligibleCount: number;
  excludedCount: number;
  totalCharacters: number;
  fullLogging: boolean;
} {
  return {
    enabled: input.enabled,
    eligibleCount: input.manifest.entries.filter((entry) => entry.included)
      .length,
    excludedCount: input.manifest.entries.filter((entry) => !entry.included)
      .length,
    totalCharacters: input.manifest.totalCharacters,
    fullLogging: input.logging.mode === "full",
  };
}
