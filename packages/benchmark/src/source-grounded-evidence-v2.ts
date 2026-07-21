import {
  parseSourceGroundedEvidenceAggregateResultV1,
  parseSourceGroundedEvidenceManifestV1,
  SOURCE_GROUNDED_EVIDENCE_MANIFEST_SHA256,
  validateSourceGroundedEvidenceCorpus,
} from "./source-grounded-evidence-v1.js";

const ID = "source-grounded-evidence-v2";
const COMMIT = "acb8f60e5f2a0e6297c0f1bc01853b0b5ee12294";
export const SOURCE_GROUNDED_EVIDENCE_V2_MANIFEST_SHA256 =
  "39e430d284e06b729de5d3aac23c754d86434613a9a2c61792e224674fb788ae";

const fail = (reason: string): never => {
  throw new Error(`SGE_V2_PARSE_FAILED:${reason}`);
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
    prompts.pi !== "pi-native-v5" ||
    prompts.openaiCompatible !== "openai-compatible-v4"
  )
    fail("prompts");
  if (manifestSha && result.manifestSha256 !== manifestSha)
    fail("manifestSha256");
  return result;
};

const v1Equivalent = (value: Record<string, unknown>) => ({
  ...value,
  benchmarkId: "source-grounded-evidence-v1",
  subjectCommit: "9d54bb4a8ba6a9cc63c0776023d5856c46199697",
  prompts: { pi: "pi-native-v4", openaiCompatible: "openai-compatible-v4" },
});

export type SourceGroundedEvidenceManifestV2 = Record<string, unknown>;
export const parseSourceGroundedEvidenceManifestV2 = (
  value: unknown,
): SourceGroundedEvidenceManifestV2 => {
  const original = assertIdentity(value);
  parseSourceGroundedEvidenceManifestV1(v1Equivalent(original));
  return original;
};

export type SourceGroundedEvidenceAggregateResultV2 = Record<string, unknown>;
export const parseSourceGroundedEvidenceAggregateResultV2 = (
  value: unknown,
): SourceGroundedEvidenceAggregateResultV2 => {
  const original = assertIdentity(
    value,
    SOURCE_GROUNDED_EVIDENCE_V2_MANIFEST_SHA256,
  );
  parseSourceGroundedEvidenceAggregateResultV1({
    ...v1Equivalent(original),
    manifestSha256: SOURCE_GROUNDED_EVIDENCE_MANIFEST_SHA256,
  });
  return original;
};

export const validateSourceGroundedEvidenceV2Corpus =
  validateSourceGroundedEvidenceCorpus;
