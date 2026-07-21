<p align="center">
  <img src="assets/intent-bridge-logo.png" width="180" alt="Intent Bridge logo">
</p>

<h1 align="center">Intent Bridge</h1>

<p align="center">
  A fail-open Pi extension that turns natural-language software requests into structured, implementation-ready context without replacing the user's original message.
</p>

> **Status:** `v1.1.0` is prepared for public npm release.

## What it does

Intent Bridge sits between the user and Pi's coding model:

```text
User message
    │
    ├── exact small talk ───────────────────────────────► Pi
    │
    └── software request ► selected model ► validation ► deterministic compiler ► Pi
                                      │
                                      └── failure ───────► original message, unchanged
```

The extension:

- interprets goals, tasks, constraints, assumptions, and unresolved ambiguities;
- preserves the language expected in the final response;
- keeps assumptions separate from user requirements;
- validates structured output before compiling it for Pi;
- sends the original message unchanged when transformation fails;
- keeps technical provider errors out of the automatic user-facing path;
- leaves authentication and provider transport to Pi.

## Language preservation example

The structured task document is written in English for consistent downstream processing, while source-language metadata and the required response language are preserved.

```text
Source language: Turkish (tr)
Source prompt: "Giriş ekranına şifremi unuttum bağlantısı ekle."
Required user-facing response language: Turkish (tr)
```

Intent Bridge does not translate this request into an English user experience. V2 intent documents record whether the response language was explicitly requested; artifact, README, code, and UI-copy languages do not override the final response language. Pi answers in Turkish unless the user explicitly requests another language.

## Requirements

- Node.js `>=22.23.1`
- Corepack with pnpm `11.15.0`
- Pi `0.80.10` exactly (the supported and tested host version)
- At least one Pi model that is available, supports text input, has finite limits, and can run with thinking disabled

CI verifies the pinned Pi `0.80.10` host regularly. A scheduled latest-Pi check is observational and non-blocking; it does not expand supported versions.

## Local quick start

Install through Pi:

```bash
pi install npm:@srcanesen/intent-bridge@1.1.0
```

Or use a local checkout:

```bash
git clone https://github.com/Srcanesen/intent-bridge.git
cd intent-bridge
corepack pnpm install --frozen-lockfile
corepack pnpm build
pi -e ./packages/pi-extension
```

Inside Pi:

1. Run `/bridge on`.
2. If no compatible model is selected, choose one from the picker.
3. Send a normal software request.
4. Run `/bridge status` to inspect the active mode and selected model.

The selection stores only provider and model identifiers. Pi continues to own authentication; Intent Bridge does not store API keys.

## Commands

### Primary workflow

| Command | Purpose |
| --- | --- |
| `/bridge on` | Enable automatic transformation. Opens model selection when required. |
| `/bridge off` | Disable transformation. |
| `/bridge model` | Select an available compatible Pi model. |
| `/bridge status` | Show current mode and model selection. |

### Review and diagnostics

| Command | Purpose |
| --- | --- |
| `/bridge preview` | Review a transformation before it is applied. |
| `/bridge preview off` | Return to automatic mode. |
| `/bridge test` | Test the selected model. |
| `/bridge last` | Show bounded metadata for the latest transformation. |
| `/bridge rate good\|bad` | Store a local rating for the latest transformation. |
| `/bridge logs` | Show local trace-log information. |
| `/bridge privacy` | Show project-context eligibility. |

## Quality review

`quality` lives under the same JSON config (global or trusted project layer) and is file-only — there is no CLI control.

Default behaviour observes every transformation (`enforcement: "observe"`), with `reviewOnHighRisk`, `reviewOnClarification`, and `reviewOnMaterialAskUser` set to `true` and `minConfidence` to `null`. A transformation that would be reviewed is still injected under observe; the assessment is observable in `/bridge last` and the trace but never blocks delivery.

Set `quality.enforcement` to `"review"` to gate the same candidates through the existing preview selector. In auto mode a review candidate with an interactive UI opens that selector; without UI the original message is sent unchanged, the `quality_review_required_no_ui` reason is recorded in the trace and the session entry, and no technical error notification is shown. The same `config.quality` always flows into the pipeline so the assessment is consistent between trace, latest state, and preview.

## Compiler configuration

The compiled task can exclude the original request text from the output. This is configured under `compiler` in the JSON config (global or trusted project layer) — no CLI control.

```json
{
  "compiler": {
    "includeOriginalRequest": false
  }
}
```

Default is `true` (original request included, backward compatible). When `false`, the `## Original user request` heading and fenced body are omitted from the compiled task. Normal user input / Pi turn behavior is unchanged. The active value is visible in the preview and `/bridge last` output (`includeOriginalRequest=true|false`).

Missing `compiler` or empty `compiler: {}` both resolve to `true`. Unknown keys and non-boolean values are strictly rejected. Explicit `false` survives layer merge/patch.

## Failure and retry behavior

Production calls use the selected provider/model with thinking disabled and native SDK retries disabled. The Bridge pipeline may retry once, using the same provider and model, only for transient timeout, reachability, rate-limit, or server failures. Authentication, configuration, JSON, schema, safety, compiler, response-size, and unknown failures are not retried.

If transformation still fails, the original user message is sent to Pi byte-for-byte unchanged. Intent Bridge does not switch to a second provider or model automatically.

Benchmark runs are intentionally stricter: concurrency is `1`, retry is `0`, and cache retention is `none` so provider reliability remains measurable.

## Privacy and security

The selected provider receives the original request. If project context is enabled, it may also receive bounded, allowlisted project metadata and instruction excerpts. Repository source code is not sent by default.

- API keys remain in Pi's existing authentication system or environment references.
- Provider/model selection stores identifiers only.
- Configuration, traces, ratings, and benchmarks remain local by default.
- There is no project-controlled telemetry.
- Full-content local tracing is opt-in and may contain request content.
- Raw benchmark review bundles are opt-in, written with mode `0600`, and must never be committed.
- Intent Bridge cannot control provider-side logging or retention; review the selected provider's privacy policy before sending sensitive material.

See [PRIVACY.md](PRIVACY.md) for the complete data-flow policy and [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Architecture

Intent Bridge keeps model-dependent interpretation separate from deterministic enforcement:

```text
Pi extension
  ├── model selection and user interaction
  ├── interpretation provider
  ├── core pipeline
  │     ├── schema validation
  │     ├── language and safety checks
  │     ├── bounded transient retry
  │     └── fail-open decision
  └── deterministic Pi compiler
```

Workspace packages:

| Package | Responsibility |
| --- | --- |
| `packages/core` | Contracts, pipeline, validation, compiler, privacy, and tracing |
| `packages/pi-extension` | Pi commands, model selection, native transport, and user experience |
| `packages/provider-openai-compatible` | Explicit OpenAI-compatible provider adapter |
| `packages/benchmark` | Fixed-corpus runner, evaluator, report integrity, and comparison tools |
| `packages/testkit` | Shared test support |

The public repository intentionally keeps architecture and operating guidance in this README; local planning documents are not distributed.

## Benchmark evidence

The fixed corpus contains exactly 50 synthetic requests in a stable order:

- 20 Turkish
- 20 English
- 10 Spanish

The committed baseline compares `opencode-go/deepseek-v4-flash` and `opencode-go/mimo-v2.5` using `openai-codex/gpt-5.6-sol` as the model evaluator with `medium` reasoning. Candidate reasoning is disabled. Runs use concurrency `1` and retry `0`.

| Candidate | Transformed | Structural | Language | Safety | Alteration | Clarity | p50 | p95 | Known cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| DeepSeek V4 Flash | 49/50 | 98% | 100% | 100% | 14.3% | 89.8% | 8.95 s | 14.23 s | $0.0127 |
| MiMo V2.5 | 47/50 | 92% | 97.9% | 100% | 6.4% | 93.6% | 17.44 s | 24.43 s | $0.0165 |

DeepSeek is the current local production selection because it was more reliable, preserved language across transformed cases, and was materially faster in this sample. This is not a universal model ranking.

A separate model-assisted audit found material request-level changes in 2 of 50 requests, so the practical summary is **48/50 requests (approximately 96%) preserved their intended meaning**. This means 96% of requests in this fixed sample passed the audit; it does **not** mean that 96% of every sentence's meaning is preserved. The baseline does not contain a completed hash-bound per-case human `OwnerReviewV1`, so it is not presented as formal human acceptance.

Sanitized evidence is stored under [`benchmarks/reports`](benchmarks/reports). It excludes raw requests, candidate outputs, prompts, credentials, secrets, and provider error bodies. See [benchmarks/README.md](benchmarks/README.md) for methodology and limitations.

The separate [implementation-outcome benchmark](benchmarks/implementation-outcome/README.md) compares an unchanged prompt with the same prompt plus one hidden compiled Intent Bridge context message in disposable synthetic repositories. Offline corpus validation is safe by default; live execution is expensive, opt-in, and rejected unless an external policy sandbox supplies compatible attestation metadata. Pi hooks are defense in depth, not containment.

## Development

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm benchmark -- validate-fixtures --cases benchmarks/cases
corepack pnpm benchmark:implementation-outcome -- validate --cases benchmarks/implementation-outcome/cases.json
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm scan:secrets
corepack pnpm release:smoke
```

Live provider benchmarks are opt-in, can transmit request/context data to providers, and may incur cost. They are not run by CI.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before opening a change. Keep commits focused and never add real credentials or provider output to fixtures.

## License

Licensed under [Apache-2.0](LICENSE).
