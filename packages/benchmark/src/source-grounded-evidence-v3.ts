import {
  parseSourceGroundedEvidenceAggregateResultV2,
  parseSourceGroundedEvidenceManifestV2,
  SOURCE_GROUNDED_EVIDENCE_V2_MANIFEST_SHA256,
  validateSourceGroundedEvidenceV2Corpus,
} from "./source-grounded-evidence-v2.js";

const ID = "source-grounded-evidence-v3";
const COMMIT = "16e82444333286e913d048856b9283b329b9872f";
export const SOURCE_GROUNDED_EVIDENCE_V3_MANIFEST_SHA256 =
  "d8d6e374d23fb263983eed2ba3540cca69153930dca1e31fb1b0652b05b9258f";

const fail = (reason: string): never => {
  throw new Error(`SGE_V3_PARSE_FAILED:${reason}`);
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

const v2Equivalent = (value: Record<string, unknown>) => ({
  ...value,
  benchmarkId: "source-grounded-evidence-v2",
  subjectCommit: "acb8f60e5f2a0e6297c0f1bc01853b0b5ee12294",
  prompts: { pi: "pi-native-v5", openaiCompatible: "openai-compatible-v4" },
});

export type SourceGroundedEvidenceManifestV3 = Record<string, unknown>;
export const parseSourceGroundedEvidenceManifestV3 = (
  value: unknown,
): SourceGroundedEvidenceManifestV3 => {
  const original = assertIdentity(value);
  parseSourceGroundedEvidenceManifestV2(v2Equivalent(original));
  return original;
};

export type SourceGroundedEvidenceAggregateResultV3 = Record<string, unknown>;
export const parseSourceGroundedEvidenceAggregateResultV3 = (
  value: unknown,
): SourceGroundedEvidenceAggregateResultV3 => {
  const original = assertIdentity(
    value,
    SOURCE_GROUNDED_EVIDENCE_V3_MANIFEST_SHA256,
  );
  parseSourceGroundedEvidenceAggregateResultV2({
    ...v2Equivalent(original),
    manifestSha256: SOURCE_GROUNDED_EVIDENCE_V2_MANIFEST_SHA256,
  });
  return original;
};

export const validateSourceGroundedEvidenceV3Corpus =
  validateSourceGroundedEvidenceV2Corpus;
