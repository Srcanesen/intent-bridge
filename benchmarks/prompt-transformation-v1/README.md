# Prompt Transformation Benchmark v1

Status: **pre-registered before corpus construction and live execution**

This benchmark tests the original Intent Bridge product promise:

> A person may describe a coding need briefly and informally. Intent Bridge should turn that request into a clearer, structured, actionable task for a coding harness without changing the person's intent, inventing requirements, or silently expanding scope.

It does not test whether a coding model can implement the task. Implementation outcome remains a separate secondary benchmark.

## Immutable subject

- Release: `v1.1.0`
- Commit: `962a431292dae8d082abf5442329939207e38c48`
- Candidate interpreter: `opencode-go/deepseek-v4-flash`
- Compiler: the `pi-v2` compiler shipped by the subject release
- Independent semantic evaluator: `openai-codex/gpt-5.6-sol`, reasoning `medium`
- Languages: Turkish (`tr`) and English (`en`) only

Any product-code, provider, model, prompt, compiler, rubric, threshold, or case change after the live run starts creates a different benchmark and must use a new version. No result from another language is included in this benchmark.

## Hypotheses

The primary claim is supported only when all gates pass:

1. **Fidelity:** the transformed task preserves every explicit goal, boundary, and constraint without material omission or contradiction.
2. **No invention:** the transformed task does not introduce unsupported product decisions, implementation requirements, dependencies, scope, or success criteria.
3. **Clarity:** short informal requests become more actionable for a coding harness.
4. **Honest ambiguity:** material missing decisions are exposed or converted into bounded clarification instead of being guessed.
5. **Language and safety:** response language is preserved, quoted user data remains untrusted, and deterministic safety invariants pass.

Intent Bridge is not expected to recover facts that are absent from both the request and supplied repository context. The correct behavior for a material unknown is to identify the ambiguity or request clarification.

## Corpus design

The confirmatory corpus contains 80 unique, secret-safe cases:

| Stratum | Turkish | English | Total |
| --- | ---: | ---: | ---: |
| Short informal requests | 24 | 24 | 48 |
| Already-clear controls | 6 | 6 | 12 |
| Material ambiguity | 6 | 6 | 12 |
| Edge and safety | 4 | 4 | 8 |
| **Total** | **40** | **40** | **80** |

Turkish and English cases are balanced by domain and difficulty but are not translations of one another in the primary informal stratum. This prevents memorized translation pairs from masquerading as language parity.

Each reviewed case records:

- explicit goal facts that must remain;
- explicit constraints and boundaries that must remain;
- allowed assumptions supported by supplied context;
- material ambiguities that must be exposed;
- prohibited or invented requirements that must not become executable instructions;
- expected clarification behavior;
- expected response language;
- tags for the pre-registered stratum and safety analysis.

Informal cases represent the intended user experience: short, conversational requests that express a real need but do not pre-write a harness specification. Clear controls verify that the bridge does not degrade a request that is already actionable. Ambiguity cases verify that precision is not fabricated. Edge/safety cases treat prompt-like content, paths, commands, and synthetic secret-like values as data.

The corpus is frozen by its merged manifest hash before any live candidate output is generated. Smoke cases are separate and never enter confirmatory aggregates.

## Evaluation

### Deterministic evidence

Existing strict parsing, compilation, language, original-request fencing, literal preservation, forbidden-addition, and safety checks remain hard evidence. Benchmark-specific validation additionally enforces the corpus count, language/stratum distribution, unique normalized inputs, annotation density, safe fixture content, and manifest hash.

Literal checks are narrow diagnostics. They cannot by themselves prove semantic fidelity.

### Semantic evidence

The approved independent evaluator receives only the original request, bounded project context, candidate intent, and compiled task as untrusted data. It returns the existing bounded verdict:

- `intentAltered`: material omission, contradiction, invention, or scope expansion;
- `clarity`: `clearer`, `equal`, or `less_clear`.

Expected annotations, thresholds, prior verdicts, provider errors, credentials, and secret material are never sent to the evaluator. Case order is fixed by the committed seed; evaluator inputs do not reveal stratum targets.

This is model-evaluator evidence, not human proof. The final report must state that limitation. Any owner review is hash-bound, separate, and cannot overwrite candidate/evaluator facts.

## Pre-registered gates

The benchmark passes only if every applicable gate passes:

| Gate | Required result |
| --- | --- |
| Attempted cases | 80/80 |
| Structural pass | at least 98% |
| Language preservation | 100% of transformed cases, and separately 100% for `tr` and `en` |
| Deterministic safety | 100% |
| Material intent alteration | at most 5% overall; report `tr` and `en` separately |
| Forbidden executable additions | 0 confirmed cases |
| Informal clarity | at least 80% of the 48 informal cases judged `clearer` |
| Informal degradation | at most 5% of informal cases judged `less_clear` |
| Clear-control degradation | 0 clear controls judged `less_clear` with material alteration |
| Ambiguity handling | at least 90% of ambiguity cases expose the annotated ambiguity or recommend bounded clarification |

Rates use fixed denominators; missing verdicts cannot improve a score. Two-sided 95% Wilson intervals are reported for all binary rates. Results are stratified by language and case type; a pooled result is never the only result shown.

No threshold is changed after corpus construction or after seeing a live candidate output. Passing supports only this bounded statement:

> On the reviewed Turkish/English corpus, Intent Bridge v1.1.0 usually converted short informal requests into clearer harness tasks while staying within the pre-registered fidelity, ambiguity, language, and safety limits.

It does not prove improved coding-model implementation success, universal language support, or performance on arbitrary repositories.

## Execution protocol

1. Merge this pre-registration.
2. Add and review the frozen corpus plus offline validator/tests in a separate PR.
3. Run all offline checks and merge only after CI passes.
4. In the externally enforced sandbox, run an 8-case balanced smoke screen that is excluded from evidence.
5. Stop on any sandbox, schema, identity, cost, or hard-safety failure.
6. Run the 80-case corpus once with concurrency `1`, no retry, and no post-hoc case replacement.
7. Evaluate each transformed case once with the approved evaluator.
8. Strict-parse and secret-scan the sanitized aggregate report.
9. Commit only aggregate evidence, immutable identities/hashes, counts, confidence intervals, thresholds, and limitations in a separate PR.

Live provider calls never run in CI and never run against an untrusted repository.

## Approved resource limits

- Smoke maximum: 8 candidate + 8 evaluator calls
- Confirmatory maximum: 80 candidate + 80 evaluator calls
- Total maximum: 176 calls
- Provider-metered spend maximum: USD 1.00
- Kimi is excluded from candidate, evaluator, and primary evidence

Execution stops before exceeding either limit. Candidate cost is taken only from observed provider usage. The evaluator uses the approved authenticated Codex provider; no API key is placed in the repository, report, command output, or review artifact.

## Isolation and evidence handling

The live run requires the same externally enforced policy class used by the implementation-outcome benchmark:

- repository source read-only;
- no write access outside the dedicated output/work area;
- home credentials inaccessible inside the candidate sandbox;
- external network denied except the approved loopback inference gateway;
- provider credentials retained outside the sandbox;
- no raw prompts, intents, compiled tasks, provider errors, or credentials in committed reports;
- any local review bundle mode `0600`, outside the repository, and deleted after bounded review.

A sanitized aggregate report is evidence only after strict parsing and secret scanning.

## PR boundaries

- **PR 17 — Pre-registration:** this document and discoverability link only.
- **PR 18 — Frozen bilingual corpus:** benchmark-only contracts/validation, 80 reviewed cases, offline tests, manifest hash, and CI evidence; no product code or live provider.
- **PR 19 — Live evidence:** sanitized aggregate report and documentation only, after the approved sandbox run.

If PR 18 requires a product behavior change to make the benchmark pass, stop. Product changes belong to a later release and must not alter the `v1.1.0` subject under test.
