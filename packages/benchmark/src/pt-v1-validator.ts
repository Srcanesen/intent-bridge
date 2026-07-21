import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBenchmarkCaseV1, type BenchmarkCaseV1 } from "./contracts.js";
import { isSafetyCase } from "./invariants.js";
import type {
  PtV1GoldAnnotation,
  PtV1Language,
  PtV1Manifest,
  PtV1Stratum,
} from "./pt-v1.js";

// ── Helpers ─────────────────────────────────────────────────────────────────
const normalize = (value: string) =>
  value.replace(/\s+/g, " ").trim().toLowerCase();

export class PtV1ValidationError extends Error {
  constructor(message: string) {
    super(`PT_V1_VALIDATION_FAILED:${message}`);
    this.name = "PtV1ValidationError";
  }
}

const fail = (reason: string): never => {
  throw new PtV1ValidationError(reason);
};

const loadJson = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail(`json-parse:${path}`);
  }
};

// ── Load corpus with strict parsing ────────────────────────────────────────
export async function loadPtV1Cases(dir: string): Promise<BenchmarkCaseV1[]> {
  const files = (await readdir(dir))
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (files.length === 0) fail("empty-cases-dir");
  const cases = await Promise.all(
    files.map(async (file) =>
      parseBenchmarkCaseV1(await loadJson(join(dir, file))),
    ),
  );
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) fail(`duplicate-id:${c.id}`);
    ids.add(c.id);
  }
  return cases;
}

// ── Load gold annotations with strict parsing ─────────────────────────────
export function parsePtV1GoldAnnotation(value: unknown): PtV1GoldAnnotation {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("annotation-not-object");
  const o = value as Record<string, unknown>;

  const caseId =
    typeof o.caseId === "string" && o.caseId.length > 0
      ? o.caseId
      : fail("annotation-caseId");
  const stratum = parseStratum(o.stratum);
  const language = parseLanguage(o.language);
  const responseLanguage = parseLanguage(o.responseLanguage);
  if (responseLanguage !== language) fail("annotation-language-mismatch");

  const explicitGoals = parseStringList(o.explicitGoals, "explicitGoals");
  const explicitConstraints = parseStringList(
    o.explicitConstraints,
    "explicitConstraints",
  );
  const allowedAssumptions = parseStringList(
    o.allowedAssumptions,
    "allowedAssumptions",
  );
  const materialAmbiguities = parseStringList(
    o.materialAmbiguities,
    "materialAmbiguities",
  );
  const prohibitedInventedRequirements = parseStringList(
    o.prohibitedInventedRequirements,
    "prohibitedInventedRequirements",
  );
  const expectedClarificationBehavior =
    typeof o.expectedClarificationBehavior === "string" &&
    o.expectedClarificationBehavior.trim().length > 0
      ? o.expectedClarificationBehavior.trim()
      : fail("annotation-expectedClarificationBehavior");
  const domain =
    typeof o.domain === "string" && o.domain.length > 0
      ? o.domain
      : fail("annotation-domain");
  const difficulty = parseDifficulty(o.difficulty);

  // Validate unknown keys
  const allowed = new Set([
    "caseId",
    "stratum",
    "language",
    "explicitGoals",
    "explicitConstraints",
    "allowedAssumptions",
    "materialAmbiguities",
    "prohibitedInventedRequirements",
    "expectedClarificationBehavior",
    "responseLanguage",
    "domain",
    "difficulty",
  ]);
  for (const key of Object.keys(o))
    if (!allowed.has(key)) fail(`annotation-unknown-key:${key}`);

  return {
    caseId,
    stratum,
    language,
    explicitGoals,
    explicitConstraints,
    allowedAssumptions,
    materialAmbiguities,
    prohibitedInventedRequirements,
    expectedClarificationBehavior,
    responseLanguage,
    domain,
    difficulty,
  };
}

function parseStratum(value: unknown): PtV1Stratum {
  if (typeof value !== "string") return fail("stratum-not-string");
  const valid: PtV1Stratum[] = [
    "informal",
    "clear",
    "ambiguity",
    "edge-safety",
  ];
  for (const v of valid) if (value === v) return v;
  return fail("stratum-invalid");
}

function parseLanguage(value: unknown): PtV1Language {
  if (typeof value !== "string") return fail("language-not-string");
  if (value === "tr") return "tr";
  if (value === "en") return "en";
  return fail("language-invalid");
}

function parseDifficulty(value: unknown): "easy" | "medium" | "hard" {
  if (typeof value !== "string") return fail("difficulty-not-string");
  if (value === "easy" || value === "medium" || value === "hard") return value;
  return fail("difficulty-invalid");
}

function parseStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) fail(`annotation-${field}-not-array`);
  const arr = value as unknown[];
  for (const item of arr)
    if (typeof item !== "string" || item.trim().length === 0)
      fail(`annotation-${field}-invalid-item`);
  return (arr as string[]).map((s: string) => s.trim());
}

// ── Manifest parsing ────────────────────────────────────────────────────────
export function parsePtV1Manifest(value: unknown): PtV1Manifest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("manifest-not-object");
  const o = value as Record<string, unknown>;

  if (o.schemaVersion !== 1) fail("manifest-schemaVersion");
  if (o.subjectRelease !== "v1.1.0") fail("manifest-subjectRelease");
  const subjectCommit =
    o.subjectCommit === "962a431292dae8d082abf5442329939207e38c48"
      ? o.subjectCommit
      : fail("manifest-subjectCommit");
  const seed =
    typeof o.seed === "number" && Number.isInteger(o.seed) && o.seed >= 0
      ? o.seed
      : fail("manifest-seed");
  if (o.totalConfirmatory !== 80) fail("manifest-totalConfirmatory");
  if (o.totalSmoke !== 8) fail("manifest-totalSmoke");

  const languages = parseLanguageArray(o.languages);
  const strata = parseStratumArray(o.strata);
  const distribution = parseDistribution(o.distribution, languages, strata);
  const smokeDistribution = parseDistribution(
    o.smokeDistribution,
    languages,
    strata,
  );

  const contentSha256 =
    typeof o.contentSha256 === "string" &&
    /^[0-9a-f]{64}$/.test(o.contentSha256)
      ? o.contentSha256
      : fail("manifest-contentSha256");
  const smokeContentSha256 =
    typeof o.smokeContentSha256 === "string" &&
    /^[0-9a-f]{64}$/.test(o.smokeContentSha256)
      ? o.smokeContentSha256
      : fail("manifest-smokeContentSha256");

  const allowed = new Set([
    "schemaVersion",
    "subjectRelease",
    "subjectCommit",
    "seed",
    "languages",
    "strata",
    "totalConfirmatory",
    "totalSmoke",
    "distribution",
    "smokeDistribution",
    "contentSha256",
    "smokeContentSha256",
  ]);
  for (const key of Object.keys(o))
    if (!allowed.has(key)) fail(`manifest-unknown-key:${key}`);

  return {
    schemaVersion: 1,
    subjectRelease: "v1.1.0" as const,
    subjectCommit,
    seed,
    languages,
    strata,
    totalConfirmatory: 80,
    totalSmoke: 8,
    distribution,
    smokeDistribution,
    contentSha256,
    smokeContentSha256,
  };
}

function parseLanguageArray(value: unknown): PtV1Language[] {
  if (!Array.isArray(value)) fail("manifest-languages-not-array");
  const arr = value as unknown[];
  const result: PtV1Language[] = [];
  for (const item of arr) {
    if (typeof item !== "string") fail("manifest-language-not-string");
    if (item === "tr") result.push("tr");
    else if (item === "en") result.push("en");
    else fail("manifest-language-invalid");
  }
  if (result.length !== 2 || !result.includes("tr") || !result.includes("en"))
    fail("manifest-language-missing");
  return result;
}

function parseStratumArray(value: unknown): PtV1Stratum[] {
  if (!Array.isArray(value)) fail("manifest-strata-not-array");
  const valid: PtV1Stratum[] = [
    "informal",
    "clear",
    "ambiguity",
    "edge-safety",
  ];
  const arr = value as unknown[];
  const result: PtV1Stratum[] = [];
  for (const item of arr) {
    if (typeof item !== "string") fail("manifest-stratum-not-string");
    if (!valid.includes(item as PtV1Stratum)) fail("manifest-stratum-invalid");
    result.push(item as PtV1Stratum);
  }
  for (const v of valid)
    if (!result.includes(v)) fail("manifest-stratum-missing");
  return result;
}

function parseDistribution(
  value: unknown,
  languages: PtV1Language[],
  strata: PtV1Stratum[],
): Record<PtV1Language, Record<PtV1Stratum, number> & { total: number }> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("manifest-distribution-not-object");
  const o = value as Record<string, unknown>;
  const result = {} as Record<
    PtV1Language,
    Record<PtV1Stratum, number> & { total: number }
  >;

  for (const lang of languages) {
    const entry = o[lang];
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      fail(`manifest-distribution-${lang}-invalid`);
    const e = entry as Record<string, unknown>;
    const dist: Record<string, number> = {};
    let sum = 0;
    for (const stratum of strata) {
      const count =
        typeof e[stratum] === "number" &&
        Number.isInteger(e[stratum] as number) &&
        (e[stratum] as number) >= 0
          ? (e[stratum] as number)
          : fail(`manifest-distribution-${lang}-${stratum}`);
      dist[stratum] = count;
      sum += count;
    }
    const total =
      typeof e.total === "number" && Number.isInteger(e.total as number)
        ? (e.total as number)
        : fail(`manifest-distribution-${lang}-total`);
    if (total !== sum) fail(`manifest-distribution-${lang}-total-mismatch`);

    const allowed = new Set([...strata, "total"]);
    for (const key of Object.keys(e))
      if (!allowed.has(key))
        fail(`manifest-distribution-${lang}-unknown-key:${key}`);

    result[lang] = { ...dist, total } as Record<PtV1Stratum, number> & {
      total: number;
    };
  }

  if (Object.keys(o).length !== languages.length) {
    for (const key of Object.keys(o))
      if (!languages.includes(key as PtV1Language))
        fail(`manifest-distribution-unknown-language:${key}`);
  }

  return result;
}

// ── Canonical serialization for hash ────────────────────────────────────────
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function canonicalCaseJson(c: BenchmarkCaseV1): string {
  return canonicalJson({
    version: c.version,
    id: c.id,
    title: c.title,
    language: c.language,
    messageType: c.messageType,
    input: c.input,
    ...(c.attachments ? { attachments: c.attachments } : {}),
    ...(c.contextFixture ? { contextFixture: c.contextFixture } : {}),
    expected: c.expected,
    tags: [...c.tags].sort(),
  });
}

/** Compute deterministic SHA-256 over canonical sorted cases, annotations, and rubric. */
export function computePtV1ContentHash(
  cases: BenchmarkCaseV1[],
  annotations: PtV1GoldAnnotation[],
  rubricContent: string,
): string {
  const hasher = createHash("sha256");
  for (const item of [...cases].sort((a, b) => a.id.localeCompare(b.id)))
    hasher.update(canonicalCaseJson(item));
  for (const item of [...annotations].sort((a, b) =>
    a.caseId.localeCompare(b.caseId),
  ))
    hasher.update(canonicalJson(item));
  // The README publishes these hashes, so exclude only the self-referential
  // values while retaining every rubric rule in the digest.
  hasher.update(
    rubricContent.replace(
      /(- (?:Confirmatory cases|Smoke cases) SHA-256: `)[0-9a-f]{64}(`)/g,
      "$1<manifest-hash>$2",
    ),
  );
  return hasher.digest("hex");
}

// ── Corpus path helpers ─────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..", "..", "..");

export const PT_V1_DEFAULT_CASES_DIR = join(
  projectRoot,
  "benchmarks",
  "prompt-transformation-v1",
  "cases",
);
export const PT_V1_DEFAULT_SMOKE_DIR = join(
  projectRoot,
  "benchmarks",
  "prompt-transformation-v1",
  "smoke",
);
export const PT_V1_DEFAULT_MANIFEST_PATH = join(
  projectRoot,
  "benchmarks",
  "prompt-transformation-v1",
  "manifest.json",
);
export const PT_V1_DEFAULT_ANNOTATIONS_PATH = join(
  projectRoot,
  "benchmarks",
  "prompt-transformation-v1",
  "annotations.json",
);
export const PT_V1_DEFAULT_SMOKE_ANNOTATIONS_PATH = join(
  projectRoot,
  "benchmarks",
  "prompt-transformation-v1",
  "annotations-smoke.json",
);
export const PT_V1_DEFAULT_RUBRIC_PATH = join(
  projectRoot,
  "benchmarks",
  "prompt-transformation-v1",
  "README.md",
);

// ── Main validation ─────────────────────────────────────────────────────────
export type PtV1AnnotationCoverage = Record<
  string,
  {
    cases: number;
    goals: number;
    constraints: number;
    assumptions: number;
    ambiguities: number;
    prohibited: number;
  }
>;

export type PtV1ValidationResult = {
  valid: boolean;
  confirmatoryCount: number;
  smokeCount: number;
  distribution: Record<PtV1Language, Record<PtV1Stratum, number>>;
  smokeDistribution: Record<PtV1Language, Record<PtV1Stratum, number>>;
  manifestHash: string;
  smokeHash: string;
  annotationCoverage: {
    confirmatory: PtV1AnnotationCoverage;
    smoke: PtV1AnnotationCoverage;
  };
  errors: string[];
};

const EXPECTED_DISTRIBUTION: Record<
  PtV1Language,
  Record<PtV1Stratum, number>
> = {
  tr: { informal: 24, clear: 6, ambiguity: 6, "edge-safety": 4 },
  en: { informal: 24, clear: 6, ambiguity: 6, "edge-safety": 4 },
};

const EXPECTED_SMOKE_DISTRIBUTION: Record<
  PtV1Language,
  Record<PtV1Stratum, number>
> = {
  tr: { informal: 1, clear: 1, ambiguity: 1, "edge-safety": 1 },
  en: { informal: 1, clear: 1, ambiguity: 1, "edge-safety": 1 },
};

export async function validatePtV1Corpus(
  casesDir?: string,
  smokeDir?: string,
  manifestPath?: string,
  annotationsPath?: string,
  smokeAnnotationsPath?: string,
  rubricPath?: string,
): Promise<PtV1ValidationResult> {
  const errors: string[] = [];
  const addError = (msg: string) => errors.push(msg);

  const cDir = casesDir ?? PT_V1_DEFAULT_CASES_DIR;
  const sDir = smokeDir ?? PT_V1_DEFAULT_SMOKE_DIR;
  const mPath = manifestPath ?? PT_V1_DEFAULT_MANIFEST_PATH;
  const aPath = annotationsPath ?? PT_V1_DEFAULT_ANNOTATIONS_PATH;
  const saPath = smokeAnnotationsPath ?? PT_V1_DEFAULT_SMOKE_ANNOTATIONS_PATH;
  const rPath = rubricPath ?? PT_V1_DEFAULT_RUBRIC_PATH;

  // ── Load cases ──────────────────────────────────────────────────────────
  let confirmatoryCases: BenchmarkCaseV1[];
  let smokeCases: BenchmarkCaseV1[];
  try {
    confirmatoryCases = await loadPtV1Cases(cDir);
  } catch (e) {
    addError(`load-confirmatory:${(e as Error).message}`);
    return {
      valid: false,
      confirmatoryCount: 0,
      smokeCount: 0,
      distribution: {
        tr: {} as Record<PtV1Stratum, number>,
        en: {} as Record<PtV1Stratum, number>,
      },
      smokeDistribution: {
        tr: {} as Record<PtV1Stratum, number>,
        en: {} as Record<PtV1Stratum, number>,
      },
      manifestHash: "",
      smokeHash: "",
      annotationCoverage: { confirmatory: {}, smoke: {} },
      errors,
    };
  }
  try {
    smokeCases = await loadPtV1Cases(sDir);
  } catch (e) {
    addError(`load-smoke:${(e as Error).message}`);
    return {
      valid: false,
      confirmatoryCount: confirmatoryCases.length,
      smokeCount: 0,
      distribution: computeDistribution(confirmatoryCases),
      smokeDistribution: {
        tr: {} as Record<PtV1Stratum, number>,
        en: {} as Record<PtV1Stratum, number>,
      },
      manifestHash: "",
      smokeHash: "",
      annotationCoverage: { confirmatory: {}, smoke: {} },
      errors,
    };
  }

  // ── Load annotations ────────────────────────────────────────────────────
  let annotations: PtV1GoldAnnotation[] = [];
  let smokeAnnotations: PtV1GoldAnnotation[] = [];
  try {
    const raw = await loadJson(aPath);
    if (!Array.isArray(raw)) addError("annotations-not-array");
    else
      annotations = raw
        .map((item: unknown, i: number) => {
          try {
            return parsePtV1GoldAnnotation(item);
          } catch (e) {
            addError(`annotation[${i}]:${(e as Error).message}`);
            return null;
          }
        })
        .filter((a): a is PtV1GoldAnnotation => a !== null);
  } catch {
    addError("annotations-unreadable");
  }
  try {
    const raw = await loadJson(saPath);
    if (!Array.isArray(raw)) addError("smoke-annotations-not-array");
    else
      smokeAnnotations = raw
        .map((item: unknown, i: number) => {
          try {
            return parsePtV1GoldAnnotation(item);
          } catch (e) {
            addError(`smoke-annotation[${i}]:${(e as Error).message}`);
            return null;
          }
        })
        .filter((a): a is PtV1GoldAnnotation => a !== null);
  } catch {
    addError("smoke-annotations-unreadable");
  }

  // ── Count distribution ──────────────────────────────────────────────────
  const distribution = countByStratum(confirmatoryCases);
  const smokeDistribution = countByStratum(smokeCases);

  // ── Validate confirmatory counts ────────────────────────────────────────
  if (confirmatoryCases.length !== 80)
    addError(`confirmatory-count:expected-80-got-${confirmatoryCases.length}`);
  for (const lang of ["tr", "en"] as PtV1Language[]) {
    for (const stratum of Object.keys(
      EXPECTED_DISTRIBUTION[lang],
    ) as PtV1Stratum[]) {
      const expected = EXPECTED_DISTRIBUTION[lang][stratum];
      const got = distribution[lang]?.[stratum] ?? 0;
      if (got !== expected)
        addError(
          `distribution:${lang}-${stratum}:expected-${expected}-got-${got}`,
        );
    }
  }

  // ── Validate smoke counts ───────────────────────────────────────────────
  if (smokeCases.length !== 8)
    addError(`smoke-count:expected-8-got-${smokeCases.length}`);
  for (const lang of ["tr", "en"] as PtV1Language[]) {
    for (const stratum of Object.keys(
      EXPECTED_SMOKE_DISTRIBUTION[lang],
    ) as PtV1Stratum[]) {
      const expected = EXPECTED_SMOKE_DISTRIBUTION[lang][stratum];
      const got = smokeDistribution[lang]?.[stratum] ?? 0;
      if (got !== expected)
        addError(
          `smoke-distribution:${lang}-${stratum}:expected-${expected}-got-${got}`,
        );
    }
  }

  // ── Validate no duplicates ──────────────────────────────────────────────
  const allCases = [...confirmatoryCases, ...smokeCases];
  const inputSet = new Set<string>();
  const titleSet = new Set<string>();
  const idSet = new Set<string>();
  for (const c of allCases) {
    const normalizedInput = normalize(c.input);
    const normalizedTitle = normalize(c.title);
    if (inputSet.has(normalizedInput)) addError(`duplicate-input:${c.id}`);
    if (titleSet.has(normalizedTitle)) addError(`duplicate-title:${c.id}`);
    if (idSet.has(c.id)) addError(`duplicate-id:${c.id}`);
    inputSet.add(normalizedInput);
    titleSet.add(normalizedTitle);
    idSet.add(c.id);
  }

  // ── Validate credential patterns ────────────────────────────────────────
  const corpus = allCases.map((c) => c.input).join("\n");
  const credentialRe =
    /\b(?:sk|rk|pk)[_-][A-Za-z0-9_-]{16,}\b|\bBearer\s+(?:(?!EXAMPLE_NOT_A_SECRET_)[A-Za-z0-9._~+/=-]){8,}\b/;
  if (credentialRe.test(corpus)) addError("credential-pattern-found");

  // ── Validate language/response match ────────────────────────────────────
  for (const c of allCases) {
    if (c.expected.responseLanguage !== c.language)
      addError(`response-language-mismatch:${c.id}`);
  }

  // ── Validate reviewed annotation facts, not just their shape ────────────
  const annotationMap = new Map(annotations.map((a) => [a.caseId, a]));
  const smokeAnnotationMap = new Map(
    smokeAnnotations.map((a) => [a.caseId, a]),
  );

  for (const c of confirmatoryCases) {
    const annotation = annotationMap.get(c.id);
    if (!annotation) {
      addError(`missing-annotation:${c.id}`);
      continue;
    }
    validateAnnotationFacts(c, annotation, false, addError);
  }
  for (const c of smokeCases) {
    const annotation = smokeAnnotationMap.get(c.id);
    if (!annotation) {
      addError(`missing-smoke-annotation:${c.id}`);
      continue;
    }
    validateAnnotationFacts(c, annotation, true, addError);
  }
  for (const id of annotationMap.keys())
    if (!confirmatoryCases.some((c) => c.id === id))
      addError(`confirmatory-annotation-not-case:${id}`);
  for (const id of smokeAnnotationMap.keys())
    if (!smokeCases.some((c) => c.id === id))
      addError(`smoke-annotation-not-case:${id}`);
  validateAnnotationDensity(annotations, false, addError);
  validateAnnotationDensity(smokeAnnotations, true, addError);

  // ── Load manifest and compute hash ──────────────────────────────────────
  let manifest: PtV1Manifest | null = null;
  try {
    manifest = parsePtV1Manifest(await loadJson(mPath));
  } catch {
    // Manifest may not exist yet during initial corpus creation
  }

  let rubricContent: string;
  try {
    rubricContent = await readFile(rPath, "utf8");
  } catch {
    rubricContent = "";
    addError("rubric-unreadable");
  }

  const computedHash = computePtV1ContentHash(
    confirmatoryCases,
    annotations,
    rubricContent,
  );
  const computedSmokeHash = computePtV1ContentHash(
    smokeCases,
    smokeAnnotations,
    rubricContent,
  );

  if (manifest) {
    if (manifest.contentSha256 !== computedHash)
      addError(
        `hash-mismatch:expected-${manifest.contentSha256}-computed-${computedHash}`,
      );
    if (manifest.smokeContentSha256 !== computedSmokeHash)
      addError(
        `smoke-hash-mismatch:expected-${manifest.smokeContentSha256}-computed-${computedSmokeHash}`,
      );
    for (const lang of ["tr", "en"] as PtV1Language[]) {
      for (const stratum of [
        "informal",
        "clear",
        "ambiguity",
        "edge-safety",
      ] as PtV1Stratum[]) {
        const expected = manifest.distribution[lang]?.[stratum] ?? -1;
        const got = distribution[lang]?.[stratum] ?? -1;
        if (got !== expected)
          addError(
            `manifest-distribution-mismatch:${lang}-${stratum}:manifest-${expected}-actual-${got}`,
          );
      }
    }
  }

  return {
    valid: errors.length === 0,
    confirmatoryCount: confirmatoryCases.length,
    smokeCount: smokeCases.length,
    distribution: distribution as Record<
      PtV1Language,
      Record<PtV1Stratum, number>
    >,
    smokeDistribution: smokeDistribution as Record<
      PtV1Language,
      Record<PtV1Stratum, number>
    >,
    manifestHash: computedHash,
    smokeHash: computedSmokeHash,
    annotationCoverage: {
      confirmatory: annotationCoverage(annotations),
      smoke: annotationCoverage(smokeAnnotations),
    },
    errors,
  };
}

// ── Internal helpers ────────────────────────────────────────────────────────
function validateAnnotationFacts(
  c: BenchmarkCaseV1,
  a: PtV1GoldAnnotation,
  smoke: boolean,
  addError: (message: string) => void,
): void {
  const prefix = smoke ? "smoke-" : "";
  if (a.responseLanguage !== c.language || a.language !== c.language)
    addError(`${prefix}annotation-language-mismatch:${c.id}`);
  if (a.stratum !== inferStratumFromTags(c.tags))
    addError(`${prefix}annotation-stratum-mismatch:${c.id}`);
  if (a.explicitGoals.length === 0)
    addError(`${prefix}annotation-empty-goals:${c.id}`);
  if (
    a.allowedAssumptions.some((x) =>
      /standard (tooling|conventions)|standart araç/i.test(x),
    )
  )
    addError(`${prefix}annotation-generic-assumption:${c.id}`);
  for (const goal of c.expected.requiredGoalConcepts)
    if (!a.explicitGoals.includes(goal))
      addError(`${prefix}expected-goal-not-annotated:${c.id}`);
  for (const constraint of c.expected.requiredConstraints)
    if (!a.explicitConstraints.includes(constraint))
      addError(`${prefix}expected-constraint-not-annotated:${c.id}`);
  for (const forbidden of c.expected.forbiddenAdditions)
    if (!a.prohibitedInventedRequirements.includes(forbidden))
      addError(`${prefix}expected-forbidden-not-annotated:${c.id}`);
  if (
    c.expected.clarificationRecommended !== undefined &&
    c.expected.clarificationRecommended !== a.materialAmbiguities.length > 0
  )
    addError(`${prefix}clarification-annotation-mismatch:${c.id}`);
}

function validateAnnotationDensity(
  annotations: PtV1GoldAnnotation[],
  smoke: boolean,
  addError: (message: string) => void,
): void {
  for (const [key, counts] of Object.entries(annotationCoverage(annotations))) {
    const [, stratum] = key.split("/") as [PtV1Language, PtV1Stratum];
    if (counts.goals < counts.cases || counts.prohibited < counts.cases)
      addError(`${smoke ? "smoke-" : ""}annotation-density:${key}`);
    if (
      (stratum === "clear" || stratum === "edge-safety") &&
      counts.constraints !== counts.cases
    )
      addError(`${smoke ? "smoke-" : ""}annotation-constraint-density:${key}`);
    if (
      (stratum === "informal" || stratum === "ambiguity") &&
      counts.ambiguities !== counts.cases
    )
      addError(`${smoke ? "smoke-" : ""}annotation-ambiguity-density:${key}`);
  }
}

export function annotationCoverage(
  annotations: PtV1GoldAnnotation[],
): PtV1AnnotationCoverage {
  const coverage: PtV1AnnotationCoverage = {};
  for (const annotation of annotations) {
    const key = `${annotation.language}/${annotation.stratum}`;
    let counts = coverage[key];
    if (!counts) {
      counts = {
        cases: 0,
        goals: 0,
        constraints: 0,
        assumptions: 0,
        ambiguities: 0,
        prohibited: 0,
      };
      coverage[key] = counts;
    }
    counts.cases += 1;
    counts.goals += annotation.explicitGoals.length;
    counts.constraints += annotation.explicitConstraints.length;
    counts.assumptions += annotation.allowedAssumptions.length;
    counts.ambiguities += annotation.materialAmbiguities.length;
    counts.prohibited += annotation.prohibitedInventedRequirements.length;
  }
  return coverage;
}

function countByStratum(
  cases: BenchmarkCaseV1[],
): Record<string, Record<string, number>> {
  const counts: Record<string, Record<string, number>> = {
    tr: { informal: 0, clear: 0, ambiguity: 0, "edge-safety": 0 },
    en: { informal: 0, clear: 0, ambiguity: 0, "edge-safety": 0 },
  };
  for (const c of cases) {
    const lang = c.language === "tr" ? "tr" : "en";
    const stratum = inferStratumFromTags(c.tags);
    if (stratum) {
      const langCounts = counts[lang];
      if (langCounts) {
        const current = langCounts[stratum];
        langCounts[stratum] = (current ?? 0) + 1;
      }
    }
  }
  return counts;
}

function inferStratumFromTags(tags: string[]): PtV1Stratum | null {
  if (tags.includes("vague") || tags.includes("risky-assumptions"))
    return "ambiguity";
  if (isSafetyCase({ tags })) return "edge-safety";
  if (tags.includes("explicit-constraints")) return "clear";
  // Default to informal (most common in this corpus)
  return "informal";
}

function computeDistribution(
  cases: BenchmarkCaseV1[],
): Record<PtV1Language, Record<PtV1Stratum, number>> {
  const dist = countByStratum(cases);
  return dist as Record<PtV1Language, Record<PtV1Stratum, number>>;
}
