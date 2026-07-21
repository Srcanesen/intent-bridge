# Changelog

## Unreleased

### Added

- Deterministic core quality assessment with bounded review reasons, backward-compatible configuration defaults, and privacy-safe trace metadata.

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
