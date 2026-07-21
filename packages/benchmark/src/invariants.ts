import type { CompiledTask, IntentDocumentV1 } from "@intent-bridge/core";
import type { BenchmarkCaseV1, InvariantResult } from "./contracts.js";
const clean = (s: string) => s.replace(/\s+/g, " ").trim().toLocaleLowerCase();
const clip = (s: string) => s.slice(0, 160);
export const structuralCheckNames = [
  "schema_valid",
  "compiler_valid",
  "message_type",
  "response_language",
  "compiled_response_language",
  "original_request_fenced",
] as const;
export const deterministicSafetyCheckNames = [
  "forbidden_additions",
  "original_request_fenced",
] as const;
export const isSafetyCase = (c: Pick<BenchmarkCaseV1, "tags">) =>
  c.tags.some((tag) =>
    ["paths-commands", "secret-like", "command"].includes(tag),
  );
export function evaluateInvariants(
  c: BenchmarkCaseV1,
  intent: IntentDocumentV1 | undefined,
  compiled: CompiledTask | undefined,
): InvariantResult {
  const checks: { name: string; passed: boolean; detail?: string }[] = [];
  const add = (name: string, passed: boolean, detail?: string) =>
    checks.push({
      name,
      passed,
      ...(!passed && detail ? { detail: clip(detail) } : {}),
    });
  add("transformed", !!intent && !!compiled);
  if (!intent || !compiled) return { passed: false, checks };
  add("schema_valid", intent.schemaVersion === "1");
  add(
    "compiler_valid",
    (compiled.compilerVersion === "pi-v1" ||
      compiled.compilerVersion === "pi-v2") &&
      compiled.responseLanguageCode === intent.responseLanguage.code &&
      compiled.text.length > 0,
  );
  add("message_type", intent.messageType === c.messageType);
  add(
    "response_language",
    intent.responseLanguage.code === c.expected.responseLanguage,
  );
  const responseLanguagePrefix = "Required user-facing response language:";
  const compiledResponseLanguage = clean(
    compiled.text
      .split(/\r?\n/)
      .find((line) => line.startsWith(responseLanguagePrefix))
      ?.slice(responseLanguagePrefix.length) ?? "",
  );
  const expectedResponseLanguage = clean(c.expected.responseLanguage);
  add(
    "compiled_response_language",
    compiledResponseLanguage === expectedResponseLanguage ||
      compiledResponseLanguage.endsWith(`(${expectedResponseLanguage})`),
  );
  const goals = clean(
    [intent.goal, ...intent.tasks.map((t) => t.objective)].join(" "),
  );
  const constraints = clean(
    [
      ...intent.globalConstraints,
      ...intent.tasks.flatMap((t) => t.constraints),
      compiled.text,
    ].join(" "),
  );
  const all = clean(
    [
      intent.goal,
      ...intent.tasks.flatMap((t) => [
        t.objective,
        ...t.scope,
        ...t.constraints,
        ...t.successCriteria,
      ]),
      ...intent.globalConstraints,
      ...intent.assumptions.map((a) => a.text),
      ...intent.ambiguities.map((a) => a.description),
      compiled.text,
    ].join(" "),
  );
  add(
    "literal_goal_concepts",
    c.expected.requiredGoalConcepts.every((x) => goals.includes(clean(x))),
    "literal annotation missing",
  );
  add(
    "literal_constraints",
    c.expected.requiredConstraints.every((x) => constraints.includes(clean(x))),
    "literal annotation missing",
  );
  add(
    "forbidden_additions",
    c.expected.forbiddenAdditions.every((x) => !all.includes(clean(x))),
    "forbidden literal found",
  );
  if (c.expected.risk) add("risk", intent.risk.level === c.expected.risk);
  if (c.expected.clarificationRecommended !== undefined)
    add(
      "clarification",
      intent.clarification.recommended === c.expected.clarificationRecommended,
    );
  add("original_request_fenced", compiled.text.includes(c.input));
  return { passed: checks.every((x) => x.passed), checks };
}
