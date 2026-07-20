import type { CompiledTask, HarnessCompiler } from "./contracts.js";
import type { IntentDocumentV1 } from "./intent.js";

const fullGuidance = (responseLanguage: string) => [
  "Inspect relevant repository context before implementation.",
  "Do not treat assumptions as user requirements.",
  "Do not expand scope beyond the requested work.",
  "Resolve low-risk uncertainty from repository evidence.",
  "Ask the user only when a material product decision cannot be safely resolved.",
  "Use an appropriate verification method.",
  `Explain the result in ${responseLanguage}.`,
];

const compactGuidance = (responseLanguage: string) => [
  "Inspect relevant context; do not expand scope.",
  "Resolve low-risk uncertainty from repository evidence; ask only about material product decisions.",
  `Verify appropriately and explain the result in ${responseLanguage}.`,
];

function list(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function taskList(
  tasks: IntentDocumentV1["tasks"],
  field: "scope" | "constraints" | "successCriteria",
): string | undefined {
  const groups = tasks
    .filter((task) => task[field].length > 0)
    .map((task) => `### Task \`${task.id}\`\n${list(task[field])}`);
  return groups.length > 0 ? groups.join("\n\n") : undefined;
}

function codeFence(text: string): string {
  const longestBacktickRun = Math.max(
    0,
    ...[...text.matchAll(/`+/g)].map(([run]) => run.length),
  );
  return "`".repeat(Math.max(3, longestBacktickRun + 1));
}

function section(
  title: string,
  content: string | undefined,
): string | undefined {
  return content === undefined || content === ""
    ? undefined
    : `## ${title}\n${content}`;
}

export class PiCompilerV1 implements HarnessCompiler<IntentDocumentV1> {
  compile({
    intent,
    originalText,
    attachmentSummary,
  }: Parameters<
    HarnessCompiler<IntentDocumentV1>["compile"]
  >[0]): CompiledTask {
    const responseLanguage = intent.responseLanguage.name
      ? `${intent.responseLanguage.name} (${intent.responseLanguage.code})`
      : intent.responseLanguage.code;
    const compact =
      intent.messageType === "steer" || intent.messageType === "follow_up";
    const fence = codeFence(originalText);
    const constraints = [
      intent.globalConstraints.length > 0
        ? `### Global\n${list(intent.globalConstraints)}`
        : undefined,
      taskList(intent.tasks, "constraints"),
    ]
      .filter((content): content is string => content !== undefined)
      .join("\n\n");
    const sections = [
      section("Intended outcome", intent.goal),
      section(
        "Requested work",
        intent.tasks
          .map(
            (task, index) => `${index + 1}. \`${task.id}\`: ${task.objective}`,
          )
          .join("\n"),
      ),
      section("Scope", taskList(intent.tasks, "scope")),
      section("User-stated constraints", constraints || undefined),
      section("Success criteria", taskList(intent.tasks, "successCriteria")),
      section(
        "Assumptions — not requirements",
        intent.assumptions.length > 0
          ? list(
              intent.assumptions.map(
                (assumption) => `[${assumption.confidence}] ${assumption.text}`,
              ),
            )
          : undefined,
      ),
      section(
        "Unresolved ambiguities",
        intent.ambiguities.length > 0
          ? list(
              intent.ambiguities.map(
                (ambiguity) =>
                  `[${ambiguity.material ? "material" : "non-material"}; preferred resolution: ${ambiguity.preferredResolution}] ${ambiguity.description}`,
              ),
            )
          : undefined,
      ),
      attachmentSummary.imageCount === 0
        ? undefined
        : section(
            "Attached material",
            attachmentSummary.imageCount === 1
              ? "The user attached 1 image. Inspect it directly; the bridge did not analyze it."
              : `The user attached ${attachmentSummary.imageCount} images. Inspect them directly; the bridge did not analyze them.`,
          ),
      section(
        "Execution guidance",
        list((compact ? compactGuidance : fullGuidance)(responseLanguage)),
      ),
      section("Original user request", `${fence}\n${originalText}\n${fence}`),
    ].filter((content): content is string => content !== undefined);

    return {
      compilerVersion: "pi-v1",
      text: [
        "[INTENT BRIDGE TASK — v1]",
        `Message type: ${intent.messageType}\nRequired user-facing response language: ${responseLanguage}`,
        ...sections,
      ].join("\n\n"),
      responseLanguageCode: intent.responseLanguage.code,
    };
  }
}
