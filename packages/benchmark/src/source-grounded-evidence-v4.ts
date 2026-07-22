import {
  parseSourceGroundedEvidenceAggregateResultV3,
  parseSourceGroundedEvidenceManifestV3,
  SOURCE_GROUNDED_EVIDENCE_V3_MANIFEST_SHA256,
  validateSourceGroundedEvidenceV3Corpus,
} from "./source-grounded-evidence-v3.js";

const ID = "source-grounded-evidence-v4";
const COMMIT = "74f8856d0c903562a4a40e9240f8dd92b04b6b56";
export const SOURCE_GROUNDED_EVIDENCE_V4_MANIFEST_SHA256 =
  "129e2c0834ea4be840245373c931541bf7cffedeb7302a5002c23ce73eecbd82";

const fail = (reason: string): never => {
  throw new Error(`SGE_V4_PARSE_FAILED:${reason}`);
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

const v3Equivalent = (value: Record<string, unknown>) => ({
  ...value,
  benchmarkId: "source-grounded-evidence-v3",
  subjectCommit: "16e82444333286e913d048856b9283b329b9872f",
  prompts: { pi: "pi-native-v6", openaiCompatible: "openai-compatible-v5" },
});

export type SourceGroundedEvidenceManifestV4 = Record<string, unknown>;
export const parseSourceGroundedEvidenceManifestV4 = (
  value: unknown,
): SourceGroundedEvidenceManifestV4 => {
  const original = assertIdentity(value);
  parseSourceGroundedEvidenceManifestV3(v3Equivalent(original));
  return original;
};

export type SourceGroundedEvidenceAggregateResultV4 = Record<string, unknown>;
export const parseSourceGroundedEvidenceAggregateResultV4 = (
  value: unknown,
): SourceGroundedEvidenceAggregateResultV4 => {
  const original = assertIdentity(
    value,
    SOURCE_GROUNDED_EVIDENCE_V4_MANIFEST_SHA256,
  );
  parseSourceGroundedEvidenceAggregateResultV3({
    ...v3Equivalent(original),
    manifestSha256: SOURCE_GROUNDED_EVIDENCE_V3_MANIFEST_SHA256,
  });
  return original;
};

export const validateSourceGroundedEvidenceV4Corpus =
  validateSourceGroundedEvidenceV3Corpus;
