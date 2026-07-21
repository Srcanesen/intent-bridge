# Benchmark fixtures

The existing 50-case interpretation corpus and reports remain unchanged. A separate 12-case implementation benchmark lives in [`implementation-outcome`](implementation-outcome/README.md); it measures downstream repository outcomes and uses its own strict contracts rather than `BenchmarkReportV2`.

The pre-registered [`prompt-transformation-v1`](prompt-transformation-v1/README.md) benchmark targets the core product promise directly: faithful, clearer harness tasks from short informal Turkish and English requests. It has separate corpus, execution, and evidence PR boundaries. The frozen bilingual corpus contains 80 confirmatory cases (40 TR, 40 EN) and 8 balanced smoke cases with gold annotations, deterministic manifest hash, and offline validation commands.

Phase 8 provides 50 human-reviewed seed cases: 20 Turkish, 20 English, and 10 Spanish. Inputs and titles are unique. The corpus covers initial, normal, steer, and follow-up messages plus bug fixes, UI, refactoring, tests, architecture, multi-task work, attachments, explicit constraints, risky ambiguity, paths/commands, mixed language, injection-like quoted data, and synthetic secret-like values.

Every committed seed has at least one reviewed English goal concept and a response-language code. Explicit and safety-sensitive cases also carry literal constraints and/or forbidden additions. Dataset validation enforces the count, distribution, unique normalized inputs/titles, taxonomy, annotation density, tag-specific structure, and absence of obvious real credential patterns.

## What the checks mean

Literal invariants are intentionally narrow. They compare case-insensitively after whitespace normalization; they are not semantic goldens and do not replace human review. Required concepts are searched in the normalized intent goals/tasks, constraints in intent constraints plus compiled output, and forbidden additions across generated intent/compiled content. Forbidden literals must not occur in the original input because the compiler deliberately fences that request verbatim.

Trace exports are tagged `trace-export` and `needs-review` with empty annotations. They are valid staging records but are excluded from this reviewed seed corpus until a person supplies meaningful annotations and removes `needs-review`.

## Metrics and ranking

- `attempted = total - skipped`; schema-valid, fail-open, and invariant-pass rates use attempted cases as the denominator. Skipped cases do not silently fail invariants.
- Language preservation uses transformed cases. Forbidden-addition rates use attempted cases that emitted that invariant check. Empty denominators produce `null`/`unavailable`.
- Latency p50/p95 use finite transformed latencies and nearest rank: sort ascending and select `ceil(p × n) - 1`.
- Usage is summed and averaged only where each token field is available. Cost totals/averages use available costs; missing values are counted and never coerced to zero.
- Quality and evaluator aggregates use only available traces/evaluations. Evaluator output is bounded model-evaluator output, not human judgement. Human/user rating metrics remain unavailable unless a real source exists.
- An evaluator is optional, off by default, and explicitly injected for offline benchmarks only. For each transformed case, the runner transmits the original request, source language/message type/attachment summary, loaded context fixture, intent, and compiled task to that evaluator provider. These inputs do not appear in results, reports, or stdout. They remain transient unless the owner explicitly supplies `--review-bundle <file>`; that local raw bundle captures the exact transformed evaluator input before the one evaluator call, including evidence for failed evaluations. Expected annotations, title/tags, invariant results, provider/profile/model identity, prior scores, credentials, headers, and provider error bodies are not transmitted.
- MVP thresholds are invariant pass ≥ 0.90, evaluator material alteration ≤ 0.05 when available, evaluator clarity ≥ 0.80 when available, language preservation = 1.0, and safety-case invariant pass = 1.0. Safety includes `paths-commands` and `secret-like` (`command` remains an alias).
- V1 archives retain their legacy schema metadata and ranking. New V2 provenance runs record `schemaVersion: "2"`, `*-v2` prompt metadata, and `compilerVersion: "pi-v2"`; strict report parsers accept only supported V1/V2 metadata. V2 keeps `attempted = total - skipped`, but structural pass requires transformation plus every `schema_valid`, `compiler_valid`, `message_type`, `response_language`, `compiled_response_language`, and `original_request_fenced` check; a missing check fails, and its target is ≥ 0.90. Language is 1.0 over all transformed cases, with a missing check counted as failure. Literal goal/constraint rates use all transformed cases and remain diagnostics only.
- V2 deterministic safety requires every `forbidden_additions` and `original_request_fenced` check for each safety case; a missing check fails, while literal/risk/clarification failures do not gate it. Evaluator evidence is unavailable when absent. Once any verdict/error exists, coverage, alteration, and clarity use all transformed cases, so missing/error verdicts cannot improve those rates. Owner-review metrics remain unavailable until a hash-bound owner review is applied.
- Model-evaluator output is not owner/human review. The separate strict `OwnerReviewV1` artifact contains only source-report SHA-256, reviewer metadata, manual pass/fail, and bounded per-case IDs/verdicts—never raw source requests or candidate content. Applying it requires exact one-to-one transformed-case coverage. The final V2 report retains only bounded owner metadata and aggregates; the review artifact stays separate.
- V2 comparison excludes literal diagnostics and any composite: structural descending, deterministic safety descending, evaluator alteration ascending, evaluator clarity descending, fail-open ascending, p50 ascending, then known cost ascending; missing values rank last. Until owner review exists, it emits deterministic side-by-side deltas and an explicit tie rather than a winner. Cross-version comparisons are rejected.

## Compiler A/B benchmark (`--compiler-ab`)

An opt-in fixed-corpus benchmark that evaluates the effect of `includeOriginalRequest=true|false` on compiled output size and invariants without altering existing V1/V2 baselines or default behavior.

### Usage

```bash
INTENT_BRIDGE_LIVE_TESTS=1 corepack pnpm benchmark:pi-corpus --compiler-ab --provider <name> --model <id> [--evaluator-provider <name> --evaluator-model <id>] [--ids id1,id2,...] [--out <dir>]
```

### Call model

- **One interpretation call** per case (shared provider latency/usage/cost recorded once).
- **Two local compiles** per case: one with `includeOriginalRequest=true`, one with `false`. Both compile from the same provider-returned intent. Provider is not called twice.
- **Up to two evaluator calls** per transformed case (one per mode) when `--evaluator-*` is configured. Without evaluator, quality is marked unavailable (not zero/pass).

### Metrics

- Character count (`text.length`, JS string length) per mode
- UTF-8 byte count (`Buffer.byteLength`) per mode — correctly handles non-ASCII
- Character/byte deltas (true − false), aggregated as mean and median
- Mode-aware deterministic invariants:
  - `true`: `original_request_fenced` (original text present in fenced section)
  - `false`: `original_request_omitted` (the `## Original user request` heading is absent; goal/task text may legitimately repeat source wording)
  - Standard checks remain comparable across both modes
- Provider latency/usage/cost are shared interpreter-only metadata. Compile and evaluator latency are per-mode and never mixed; evaluator attempts, successes, and bounded failures are counted separately per mode.
- Provider token usage is labeled as shared interpreter-only data, not per-mode.

### Limitations

- Characters/bytes are NOT token counts and must not be labeled as such.
- Downstream Pi coding outcome is not measured.
- Default `includeOriginalRequest=true` **cannot change based on this benchmark alone** without semantic preservation evidence from the full evaluation pipeline.
- The A/B report (`CompilerAbReportV1`) is strictly sanitized: no raw prompts, intents, compiled content, provider error bodies, or secrets.

### Output

The sanitized A/B report is written as mode `0600` JSON after strict validation and the bounded aggregate summary is printed to stdout. It retains ordered `transformed`, `fail_open`, or `skipped` results; paired size/invariant metrics cover transformed pairs only. Neither output contains raw content or case details.

## Offline use

Benchmark entrypoints form a separate execution policy: they do not load production retry configuration and explicitly pass `maxRetries: 0`. Use a temporary output directory (and temporary `INTENT_BRIDGE_HOME` when a command needs Bridge state); production keeps its independently configurable bounded retry policy. This logical isolation uses the repository lockfile and does not require Docker.

```bash
corepack pnpm benchmark -- help
corepack pnpm benchmark -- validate-fixtures --cases benchmarks/cases
corepack pnpm benchmark -- compare /tmp/profile-a-report.json /tmp/profile-b-report.json --out /tmp/comparison.json
corepack pnpm benchmark -- apply-review /tmp/report.json /tmp/review.json --out /tmp/final.json
corepack pnpm benchmark:pi-local
corepack pnpm benchmark:pi-corpus --help
corepack pnpm benchmark -- pt-v1 validate
corepack pnpm benchmark -- pt-v1 summarize report.json manifest.json annotations.json [--out file]
```

`benchmark apply-review` is offline and makes no provider calls. It requires `--out`, accepts only V2 source reports without an existing owner review, verifies the canonical strict-parsed report SHA-256, and writes deterministic pretty JSON.

For an owner review of a Pi-native corpus run, add paired evaluator arguments and an explicit local path, for example `--evaluator-provider <name> --evaluator-model <id> --review-bundle /tmp/intent-bridge-raw-review.json`. There is no default bundle path and no extra evaluator call. The script creates parent directories and writes the raw file as mode `0600`. Inspect it locally, copy only `reviewArtifactTemplate` into a separate `/tmp/review.json`, replace every null verdict/time/acceptance placeholder, remove nothing else, and run `benchmark apply-review` against the written sanitized report. The template is deliberately marked incomplete and is not valid `OwnerReviewV1` until filled. Delete the raw bundle after review. Never pass it to `writeReport` or sanitization, and never commit it.

`benchmark run` additionally accepts `--contexts <dir>` (default `benchmarks/contexts`). It is blocked before config/provider loading unless `INTENT_BRIDGE_LIVE_TESTS=1`. Keep API keys in the environment variable named by the selected global profile; never place keys in command arguments. Phase 8 verification used injected mock providers only and made no paid or external network calls.

## Latency investigation (no production change)

Two opt-in scripts make the latency picture measurable without changing production behavior. Neither script mutates the bundle, schema, security, or small-talk set.

- `packages/pi-extension/scripts/benchmark-local-latency.mjs` — runs in-process against a synthetic provider. It reports only byte counts, file/total context counts, and timing aggregates (config, selection, context, sequential vs. parallel candidate prep, 50-corpus parse, 50-corpus compile). It never prints prompt text, user inputs, titles, error bodies, headers, or keys.
- `packages/pi-extension/scripts/benchmark-native-corpus.mjs` — opt-in only when `INTENT_BRIDGE_LIVE_TESTS=1`. Accepts one candidate `--provider/--model`, bounded `concurrency 1..4`, optional comma-separated `--ids`, `--out <dir>`, and `--contexts <dir>` (default `benchmarks/contexts`), plus optional paired `--evaluator-provider/--evaluator-model` and an optional bounded `--evaluator-reasoning <off|minimal|low|medium|high|xhigh|max>` (default `off`, rejected if set without the paired evaluator args). `--review-bundle <file>` is available only with that evaluator pair and has no default. The exact candidate provider/model pair cannot evaluate itself; the same provider with a different model is allowed. One Pi `ModelRuntime` validates both models and thinking-off compatibility. Each transformed case is sent once to the explicitly selected evaluator provider with no retries, reasoning selected by `--evaluator-reasoning` (default off), no cache retention, and a 30-second abort/timeout. The evaluator receives only the original request/source metadata/project context and candidate intent/compiled task as untrusted JSON data; report evaluator metadata is added afterward and is not sent in that input. The model evaluator output is not a human review. New native corpus runs always write canonical sanitized Report V2; the optional raw bundle is hash-bound to exactly that persisted report and is never included in report or aggregate output. The persisted V2 report carries the bounded reasoning in `evaluator.reasoning`; old reports without it roundtrip unchanged. V2 comparisons reject mismatched evaluator presence/provider/model/promptVersion/reasoning as `BENCHMARK_EVALUATOR_CONFIG_MISMATCH`; old-old reports with both reasoning absent remain comparable. Without evaluator arguments, evaluator evidence and thresholds remain unavailable. New reports include only bounded corpus identity metadata (count and SHA-256 hashes, never raw corpus text); comparison requires identical ordered unique case IDs and matching metadata when present, while legacy Report V2 files remain readable. Consumers reject result/aggregate/threshold inconsistencies before comparison, review hashing, or persistence. Stdout is aggregate-only: safe profile/evaluator identity, V2 structural, deterministic-safety, evaluator, explicitly labeled literal diagnostic and language rates, latency/token/cost fields, and thresholds. It excludes legacy `invariantPassRate`, case IDs/titles/text, provider error bodies, and raw bundle content/path.

### Measured baseline (this repo, in-process)

- `nativeSystem` 3946 bytes, `canonicalSchema` 3063 bytes, `nativeToolSchema` 219 bytes.
- This repo context: 0 included / 3 excluded / 0 chars.
- Median config 0.075 ms, selection 0.051 ms, context 0.086 ms.
- Median sequential local prep 0.202 ms; parallel candidate 0.166 ms.
- Median 50-corpus parse per case 0.0020 ms; compile per case 0.0016 ms.
- Native options asserted: `reasoning: "off"`, `maxTokens: 4096`, `maxRetries: 0`, `cacheRetention: "none"`.

### Live 8-case screen (rejected; full corpus never started)

24 live calls across three models, all rejected for quality. None of the candidate optimizations below was adopted.

| Profile | Transformed / 8 | Invariant pass rate | p50 (ms) | p95 (ms) | Max output tokens | Cost estimate (USD) |
|---|---:|---|---:|---:|---:|---:|
| openai-codex / gpt-5.4-mini | 4/8 | 0/8 | 8400 | 12652 | 766 | 0.012591 |
| opencode / deepseek-v4-flash-free | 5/8 | 0/8 | 14699 | 17692 | 1646 | 0 |
| opencode-go / glm-5.1 | 6/8 | 0/8 | 20448 | 26366 | 1286 | 0.0293586 |

### Rejected or deferred production changes

All five were considered and explicitly not adopted; the bundle, schema, security posture, and small-talk set are unchanged.

- **Prompt shrink** — rejected for quality. The 3946-byte native system prompt carries security, language-preservation, scope, and strict-schema instructions. Compressing it would either drop one of those contracts or require brittle rephrasing, neither of which the live screen supports (invariant pass rate is 0/8 for all three candidates already). The deterministic small-talk bypass remains separate and unchanged.
- **Context reduction** — rejected as already negligible. The repo-context collector returns 0 included / 3 excluded / 0 chars; shrinking it changes nothing.
- **2048 token cap on `maxTokens`** — rejected as unmeasured. The current cap is `min(max(model.maxTokens, 1), 4096)` and the live screen's `maxOutputTokens` tops out at 1646. Lowering the cap to 2048 risks truncating valid structured intent before quality has a chance to recover, so any reduction must wait until the live corpus has a passing baseline.
- **Config cache** — rejected as negligible. Median `loadLayeredConfig` is 0.075 ms over 100 runs; there is no production path that calls it more than once per request.
- **Parallel I/O for local prep** — rejected as negligible. Parallel candidate (selection + context) is 0.166 ms vs. sequential 0.202 ms — a 36 μs median delta in a stage already dominated by the provider call. Worth revisiting only if the provider path becomes local-resident.

### Direct-object tool schema experiment (rejected)

A bounded follow-up replaced the string-wrapped `intentJson` tool argument with the canonical IntentDocument schema directly, removing double JSON encoding without weakening validation or security instructions. A structural four-call probe confirmed one Codex failure was an unparseable `intentJson` string; no raw response or prompt content was logged. The candidate reduced the native system prompt from 3946 to 848 bytes, moved the canonical schema into the tool definition (219 to 3164 bytes), and reduced their combined serialized size by 153 bytes.

| Profile | Transformed before → after | Invariant before → after | p50 before → after (ms) | p95 before → after (ms) |
|---|---:|---:|---:|---:|
| openai-codex / gpt-5.4-mini | 4/8 → 8/8 | 0/8 → 0/8 | 8400 → 8272 | 12652 → 10663 |
| opencode / deepseek-v4-flash-free | 5/8 → 7/8 | 0/8 → 0/8 | 14699 → 16410 | 17692 → 22257 |

The production change was reverted: the required invariant threshold still failed, and DeepSeek latency regressed. The experiment also exposed a separate evaluation issue: required annotations are multi-word English phrases matched as exact substrings, although only 3/57 goal phrases and 11/86 constraint phrases occur literally in the multilingual inputs. Changing that quality contract requires a separate owner-approved evaluation-design decision; it must not be weakened merely to make this optimization pass.

## Provider-leakage diagnostic v1

A separate frozen protocol [`provider-leakage-diagnostic-v1`](provider-leakage-diagnostic-v1/README.md) targets interpreter-metadata leakage detection for the fixed product commit `766ed0e`. It reuses the PT-v1 corpus without copying it, adds a strict offline-verifiable manifest, and enforces a fully Turkish human-review workflow. PR/CI validation is offline and makes no live calls; separately approved execution permits live candidate/evaluator calls only through the externally enforced sandbox and bounded loopback gateways.
