import type { BenchmarkReportV2 } from "./contracts.js";

// ── Stratum and language types ──────────────────────────────────────────────
export type PtV1Language = "tr" | "en";
export type PtV1Stratum = "informal" | "clear" | "ambiguity" | "edge-safety";

// ── Semantic gold annotation (stored separately from BenchmarkCaseV1) ───────
export type PtV1GoldAnnotation = {
  caseId: string;
  stratum: PtV1Stratum;
  language: PtV1Language;
  explicitGoals: string[];
  explicitConstraints: string[];
  allowedAssumptions: string[];
  materialAmbiguities: string[];
  prohibitedInventedRequirements: string[];
  expectedClarificationBehavior: string;
  responseLanguage: PtV1Language;
  domain: string;
  difficulty: "easy" | "medium" | "hard";
};

// ── Frozen manifest ─────────────────────────────────────────────────────────
export type PtV1DistributionEntry = {
  informal: number;
  clear: number;
  ambiguity: number;
  "edge-safety": number;
  total: number;
};

export type PtV1Manifest = {
  schemaVersion: 1;
  subjectRelease: "v1.1.0";
  subjectCommit: "962a431292dae8d082abf5442329939207e38c48";
  seed: number;
  languages: PtV1Language[];
  strata: PtV1Stratum[];
  totalConfirmatory: 80;
  totalSmoke: 8;
  distribution: Record<PtV1Language, PtV1DistributionEntry>;
  smokeDistribution: Record<PtV1Language, PtV1DistributionEntry>;
  contentSha256: string;
  smokeContentSha256: string;
};

// ── Summarizer input ────────────────────────────────────────────────────────
export type PtV1SummarizerInput = {
  report: BenchmarkReportV2;
  manifest: PtV1Manifest;
  annotations: PtV1GoldAnnotation[];
};

// ── Bounded sanitized summary output (no raw prompts, titles, intent, etc.) ─
export type PtV1GateResult = {
  gate: string;
  status: "pass" | "fail" | "unavailable";
  numerator: number;
  denominator: number;
  rate: number | null;
  wilsonLower: number | null;
  wilsonUpper: number | null;
  detail?: string;
};

export type PtV1StratifiedRate = {
  stratum: PtV1Stratum | "all";
  language: PtV1Language | "all";
  metric: string;
  numerator: number;
  denominator: number;
  rate: number | null;
  wilsonLower: number | null;
  wilsonUpper: number | null;
};

export type PtV1SummarizerOutput = {
  manifestSha256: string;
  smokeManifestSha256: string;
  subjectRelease: string;
  subjectCommit: string;
  seed: number;
  totalConfirmatoryCases: number;
  totalSmokeCases: number;
  gates: PtV1GateResult[];
  stratifiedRates: PtV1StratifiedRate[];
  callCostMetadata: {
    totalLatencyMs: number | null;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number | null;
  };
  limitations: string[];
};
