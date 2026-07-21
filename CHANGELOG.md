# Changelog

## Unreleased

## 1.1.0 — 2026-07-21

### Added

- Opt-in PR7 / IB-06 implementation-outcome A/B benchmark with a separate strict report contract, 12 deterministic disposable repository fixtures, exact Pi/Bridge model selection, aggregate-only output, and mandatory external policy-sandbox attestation for live runs. The controlled aggregate reported treatment task success of 50% versus control at 58.33%; it does not establish a winner.
- IntentDocument V2 response-language provenance: built-in providers emit bounded `user_explicit` or `source_language_default` metadata. V2 preserves source language unless the user explicitly changes the final response/explanation language; V1 documents retain the archived regex fallback.
- `PiCompilerOptions` with `includeOriginalRequest` (default `true`). `PiCompilerV1` constructor accepts partial options. When `false`, the entire `## Original user request` heading and fenced body is omitted from compiled output; normal user input / Pi turn remains byte-for-byte unchanged.
- Bridge config `compiler.includeOriginalRequest` field with strict validation (unknown keys / non-boolean rejected). Missing `compiler` or empty `compiler: {}` resolve to `true`. Explicit `false` survives layer merge/patch.
- Extension wiring: `PiCompilerV1` constructed with effective `config.compiler`. Preview and `/bridge last` display `includeOriginalRequest=true|false` using existing bounded/redacted formatting (no raw request duplication or cap relaxation).
- Isolated fixed-corpus Compiler A/B benchmark (`CompilerAbReportV1` with strict parser, `runCompilerAbBenchmark`, `evaluateCompilerAbInvariants`). One provider interpretation call per case followed by two local compiles (true/false); optional evaluator called exactly twice per transformed case (one per mode). Reports character (JS string length) and UTF-8 byte deltas, mode-aware invariants, and separate provider/evaluator/compile latency fields.
- `--compiler-ab` opt-in flag on `packages/pi-extension/scripts/benchmark-native-corpus.mjs`. Without the flag, behavior/output/report remains exactly current. With the flag, requires live-test gate, runs A/B path, writes sanitized A/B report, and prints bounded aggregate summary. Help/cost notice discloses one interpretation call + up to two evaluator calls per transformed case; characters/bytes are not token counts; downstream Pi coding outcome is not measured.
- Pi host completion capability adapter with a one-time public-delegate-first/runtime-fallback resolution, bounded capability-source diagnostics, exact `0.80.10` support metadata, pinned compatibility CI, and scheduled non-blocking latest observation.
- Exact fingerprint-collision fail-safe/tombstone invariant for pending Pi transformations: every active duplicate is permanently non-injectable, late completions are rejected, matching agent-start events receive the original turn, and bounded expiry, capacity quarantine, and lifecycle cleanup apply.
- Deterministic core quality assessment with bounded review reasons, backward-compatible configuration defaults, and privacy-safe trace metadata.
- Quality review delivery wiring: `config.quality` flows into the pipeline, and the Pi extension routes auto-mode review candidates through the existing preview selector (or preserves the original when no UI is available). The `quality_review_required_no_ui` reason is recorded in the trace and `intent-bridge.preview` session entry.
- Preview and `/bridge last` now surface bounded, redacted assessment fields: outcome, decision reasons, active enforcement, risk level and reasons, confidence, clarification recommendation, and material ask_user ambiguities.
- Separate `## Interpreter advisory — not user requirements` section in the compiled task (compiler version `pi-v2`). The advisory is omitted for clean compact or follow-up output, and is always distinguished from user-stated constraints.

### Changed

- Decomposed the Pi extension entry point into provider resolution, transformation/session control, and command-routing modules while preserving registration order and observable behavior.
- Rating feedback now reports persistence accurately: durable save is confirmed only when persistent logging writes successfully; otherwise it is recorded for the session.
- Offline implementation-outcome fixture validation runs in CI.
- Removed the unavailable implementation-outcome language metric from the report contract.
- GitHub Actions use Node 24 action runtimes.

## 1.0.0 — 2026-07-21

First public GitHub release.

### Added

- Pi-native model selection through `/bridge on`, `/bridge model`, and `/bridge status`.
- Structured multilingual intent interpretation with deterministic compilation for Pi.
- Automatic language preservation, including Turkish (`tr`), English (`en`), and Spanish (`es`).
- Fail-open delivery of the original message when transformation cannot be completed safely.
- Bounded same-provider/model retry for transient production failures; benchmark retries remain disabled.
- Sanitized fixed-corpus benchmark reports and integrity-checked comparison tooling.
- Local privacy controls, bounded tracing, secret scanning, release smoke tests, and public project documentation.
- Intent Bridge visual identity and project logo.

### Baseline evidence

- Fixed corpus: 50 synthetic requests (20 Turkish, 20 English, 10 Spanish).
- Selected local production model: `opencode-go/deepseek-v4-flash` with reasoning disabled.
- Model evaluator: `openai-codex/gpt-5.6-sol` with `medium` reasoning.
- Request-level intent preservation in the bounded model-assisted audit: 48/50 (approximately 96%).

The 96% figure is the percentage of requests in this fixed sample whose intent was preserved, not the percentage of meaning preserved inside every sentence. The baseline has no completed per-case human `OwnerReviewV1`; see the README for limitations.

### Distribution

- Published as source code, Git tag `v1.0.0`, and a GitHub release.
- Not published to npm.
