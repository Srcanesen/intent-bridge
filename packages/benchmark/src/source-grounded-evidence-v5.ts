import {
  parseSourceGroundedEvidenceAggregateResultV4,
  parseSourceGroundedEvidenceManifestV4,
  SOURCE_GROUNDED_EVIDENCE_V4_MANIFEST_SHA256,
  validateSourceGroundedEvidenceV4Corpus,
} from "./source-grounded-evidence-v4.js";

const ID = "source-grounded-evidence-v5";
const COMMIT = "74f8856d0c903562a4a40e9240f8dd92b04b6b56";
export const SOURCE_GROUNDED_EVIDENCE_V5_MANIFEST_SHA256 =
  "e682c5b5863eb978e3cb89dcce1143c2e6aa3e2cf8310650f1ce4f47f1ce9bcd";

const fail = (reason: string): never => {
  throw new Error(`SGE_V5_PARSE_FAILED:${reason}`);
};
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail("not-object");

const assertIdentity = (value: unknown, manifestSha?: string) => {
  const result = object(value);
  if (
    result.schemaVersion !== 1 ||
    result.benchmarkId !== ID ||
    result.subjectRelease !== "v1.2.0-rc" ||
    result.subjectCommit !== COMMIT
  )
    fail("identity");
  const prompts = object(result.prompts);
  if (
    Object.keys(prompts).length !== 2 ||
    prompts.pi !== "pi-native-v6" ||
    prompts.openaiCompatible !== "openai-compatible-v5"
  )
    fail("prompts");
  if (manifestSha && result.manifestSha256 !== manifestSha)
    fail("manifestSha256");
  return result;
};

const v4Equivalent = (value: Record<string, unknown>) => ({
  ...value,
  benchmarkId: "source-grounded-evidence-v4",
  subjectCommit: "74f8856d0c903562a4a40e9240f8dd92b04b6b56",
  prompts: { pi: "pi-native-v6", openaiCompatible: "openai-compatible-v5" },
});

export type SourceGroundedEvidenceManifestV5 = Record<string, unknown>;
export const parseSourceGroundedEvidenceManifestV5 = (
  value: unknown,
): SourceGroundedEvidenceManifestV5 => {
  const original = assertIdentity(value);
  parseSourceGroundedEvidenceManifestV4(v4Equivalent(original));
  return original;
};

export type SourceGroundedEvidenceAggregateResultV5 = Record<string, unknown>;
export const parseSourceGroundedEvidenceAggregateResultV5 = (
  value: unknown,
): SourceGroundedEvidenceAggregateResultV5 => {
  const original = assertIdentity(
    value,
    SOURCE_GROUNDED_EVIDENCE_V5_MANIFEST_SHA256,
  );
  parseSourceGroundedEvidenceAggregateResultV4({
    ...v4Equivalent(original),
    manifestSha256: SOURCE_GROUNDED_EVIDENCE_V4_MANIFEST_SHA256,
  });
  return original;
};

export const validateSourceGroundedEvidenceV5Corpus =
  validateSourceGroundedEvidenceV4Corpus;
