import {
  redactSecrets,
  type FullInMemoryTransformation,
} from "@intent-bridge/core";

export const PREVIEW_CHOICES = [
  "Send transformed",
  "Send original",
  "Cancel",
] as const;

const CAP = 5_000;

function bounded(text: string): string {
  const redacted = redactSecrets(text).text;
  return redacted.length <= CAP
    ? redacted
    : `${redacted.slice(0, CAP - 14)}\n[truncated]`;
}

function list(items: readonly string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function transformationDetails(
  transformation: FullInMemoryTransformation,
): string {
  const intent = transformation.intent;
  const tasks = intent.tasks.map(
    (task, index) =>
      `${index + 1}. ${task.objective}${task.scope.length ? `\n   Scope: ${task.scope.join("; ")}` : ""}${task.constraints.length ? `\n   Constraints: ${task.constraints.join("; ")}` : ""}`,
  );
  const text = [
    "INTENT BRIDGE PREVIEW",
    "\n## Source language",
    intent.sourceLanguage.name
      ? `${intent.sourceLanguage.name} (${intent.sourceLanguage.code})`
      : intent.sourceLanguage.code,
    "\n## Interpreted goal",
    intent.goal,
    "\n## Tasks",
    list(tasks),
    "\n## Global constraints",
    list(intent.globalConstraints),
    "\n## Task constraints",
    list(intent.tasks.flatMap((task) => task.constraints)),
    "\n## Assumptions",
    list(intent.assumptions.map((assumption) => assumption.text)),
    "\n## Ambiguities",
    list(intent.ambiguities.map((ambiguity) => ambiguity.description)),
    "\n## English compiled task",
    transformation.compiledTask.text,
  ].join("\n");
  return text;
}

export function formatTransformation(
  transformation: FullInMemoryTransformation,
): string {
  return bounded(transformationDetails(transformation));
}

export function formatLastTransformation(
  transformation: FullInMemoryTransformation,
  metadata: string,
): string {
  return bounded(
    `${metadata}\n\nOriginal request:\n${transformation.originalText}\n\n${transformationDetails(transformation)}`,
  );
}
