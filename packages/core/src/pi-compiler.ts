import type { CompiledTask, HarnessCompiler } from "./contracts.js";
import type { IntentDocument } from "./intent.js";
import type { IntentEvidenceV1 } from "./intent-evidence.js";
import { redactSecrets } from "./privacy.js";
import type { TransformationAssessment } from "./quality-policy.js";

export interface PiCompilerOptions {
  includeOriginalRequest: boolean;
}

const DEFAULT_COMPILER_OPTIONS: PiCompilerOptions = {
  includeOriginalRequest: true,
};

const ADVISORY_HEADING = "Interpreter advisory — not user requirements";
const ADVISORY_BUDGET = 1_000;

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
  tasks: IntentDocument["tasks"],
  field: "scope" | "constraints" | "successCriteria",
): string | undefined {
  const groups = tasks
    .filter((task) => task[field].length > 0)
    .map((task) => `### Task \`${task.id}\`\n${list(task[field])}`);
  return groups.length > 0 ? groups.join("\n\n") : undefined;
}

function sourcedConstraints(
  intent: IntentDocument,
  evidence: IntentEvidenceV1,
  sources: ReadonlySet<IntentEvidenceV1["items"][number]["source"]>,
): string | undefined {
  const sourceByPath = new Map(
    evidence.items.map((item) => [item.path, item.source]),
  );
  const hasSource = (path: string) => {
    const source = sourceByPath.get(path);
    return source !== undefined && sources.has(source);
  };
  const global = intent.globalConstraints.filter((_, index) =>
    hasSource(`/globalConstraints/${index}`),
  );
  const tasks = intent.tasks
    .map((task, taskIndex) => ({
      id: task.id,
      constraints: task.constraints.filter((_, index) =>
        hasSource(`/tasks/${taskIndex}/constraints/${index}`),
      ),
    }))
    .filter((task) => task.constraints.length > 0)
    .map((task) => `### Task \`${task.id}\`\n${list(task.constraints)}`);
  const groups = [
    global.length > 0 ? `### Global\n${list(global)}` : undefined,
    ...tasks,
  ].filter((content): content is string => content !== undefined);
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

function safeLine(text: string): string {
  return redactSecrets(text)
    .text.replace(/\r/g, "")
    .replace(/\n+/g, " ")
    .replace(/[ \t]+\n/g, "\n");
}

function materialAskUserAmbiguities(
  intent: IntentDocument,
): IntentDocument["ambiguities"] {
  return intent.ambiguities.filter(
    (ambiguity) =>
      ambiguity.material && ambiguity.preferredResolution === "ask_user",
  );
}

function riskReasons(intent: IntentDocument): readonly string[] {
  return intent.risk.reasons.slice(0, 10);
}

function confidenceOnlyReview(assessment: TransformationAssessment): boolean {
  return (
    assessment.reasons.length === 1 &&
    assessment.reasons[0] === "confidence_below_threshold"
  );
}

function advisoryContent(
  intent: IntentDocument,
  assessment: TransformationAssessment,
): string | undefined {
  const reasons = riskReasons(intent);
  const askUser = materialAskUserAmbiguities(intent);
  const clarification = intent.clarification;
  const confidenceOnly = confidenceOnlyReview(assessment);
  const hasSignals =
    intent.risk.level === "high" ||
    clarification.recommended ||
    askUser.length > 0;
  if (!confidenceOnly && !hasSignals) return undefined;

  const assessmentReasons =
    assessment.reasons.length > 0 ? ` (${assessment.reasons.join(", ")})` : "";
  const assessmentLine = `- Assessment outcome: ${assessment.outcome}${assessmentReasons}. This section is interpreter advisory, not user-stated requirements.`;
  const lines: string[] = [];
  if (confidenceOnly)
    lines.push(`- Observed confidence: ${assessment.observedConfidence}.`);
  if (intent.risk.level === "high") {
    const reasonSuffix = reasons.length > 0 ? ` — ${reasons.join("; ")}` : "";
    lines.push(`- Risk: high${reasonSuffix}.`);
  }
  if (clarification.recommended) {
    const reasonSuffix = clarification.reason
      ? ` — ${clarification.reason}`
      : "";
    lines.push(`- Clarification recommended${reasonSuffix}.`);
  }
  for (const ambiguity of askUser)
    lines.push(`- Material ask_user ambiguity: ${ambiguity.description}.`);
  const body = [assessmentLine, ...lines.map((line) => safeLine(line))].join(
    "\n",
  );
  if (body.length <= ADVISORY_BUDGET) return body;
  return `${body.slice(0, ADVISORY_BUDGET - 14)}\n[truncated]`;
}

export class PiCompilerV1 implements HarnessCompiler<IntentDocument> {
  private readonly options: PiCompilerOptions;

  constructor(options?: Partial<PiCompilerOptions>) {
    this.options = { ...DEFAULT_COMPILER_OPTIONS, ...options };
  }

  compile({
    intent,
    originalText,
    attachmentSummary,
    assessment,
    evidence,
  }: Parameters<HarnessCompiler<IntentDocument>["compile"]>[0]): CompiledTask {
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
    const constraintSections = evidence
      ? [
          section(
            "User-stated constraints",
            sourcedConstraints(intent, evidence, new Set(["user_original"])),
          ),
          section(
            "Project-context constraints",
            sourcedConstraints(
              intent,
              evidence,
              new Set(["project_summary", "project_instruction"]),
            ),
          ),
        ]
      : [section("User-stated constraints", constraints || undefined)];
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
      ...constraintSections,
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
        ADVISORY_HEADING,
        assessment ? advisoryContent(intent, assessment) : undefined,
      ),
      section(
        "Execution guidance",
        list((compact ? compactGuidance : fullGuidance)(responseLanguage)),
      ),
      ...(this.options.includeOriginalRequest
        ? [
            section(
              "Original user request",
              `${fence}\n${originalText}\n${fence}`,
            ),
          ]
        : []),
    ].filter((content): content is string => content !== undefined);

    return {
      compilerVersion: "pi-v2",
      text: [
        "[INTENT BRIDGE TASK — v1]",
        `Message type: ${intent.messageType}\nRequired user-facing response language: ${responseLanguage}`,
        ...sections,
      ].join("\n\n"),
      responseLanguageCode: intent.responseLanguage.code,
    };
  }
}
