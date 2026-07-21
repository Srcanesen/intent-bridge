# Benchmark reports

This directory holds sanitized Report V2 artifacts and a
sanitized side-by-side comparison for the bounded local baseline
accepted on 2026-07-20 through project-level owner approval plus an
automated/model-assisted technical audit. This is not a per-case
human owner review; the limitations are recorded below.

## Committed artifacts

| file | profile | model | role |
| --- | --- | --- | --- |
| `2026-07-20-deepseek-v4-flash-sol-medium-v2.json` | `pi:opencode-go:deepseek-v4-flash` | `deepseek-v4-flash` | selected baseline (Report V2) |
| `2026-07-20-mimo-v2.5-sol-medium-v2.json` | `pi:opencode-go:mimo-v2.5` | `mimo-v2.5` | rejected comparison profile (Report V2) |
| `2026-07-20-deepseek-vs-mimo-sol-medium-v2.json` | — | — | sanitized side-by-side comparison |
| `2026-07-21-prompt-transformation-v1-smoke.json` | `pi:opencode-go-gateway:deepseek-v4-flash` | `deepseek-v4-flash` | pre-registered TR/EN smoke stop evidence |
| `2026-07-21-source-grounded-evidence-v1-smoke.json` | `pi:opencode-go-gateway:deepseek-v4-flash` | `deepseek-v4-flash` | kaynak kanıtı v1 smoke stop kanıtı |
| `2026-07-21-source-grounded-evidence-v2-smoke.json` | `pi:opencode-go-gateway:deepseek-v4-flash` | `deepseek-v4-flash` | kaynak kanıtı v2 smoke stop kanıtı |

All six files are sanitized evidence artifacts. Their SHA-256 was
verified when they were prepared, and their committed file mode is
`0644`.

## Kaynağa dayalı kanıt v2 smoke kararı

Pi-native v5 doğrudan araç şemasıyla dondurulmuş sekiz vaka dış sandbox içinde yürütüldü. Sonuç `6× INTENT_SCHEMA_INVALID`, `2× PROVIDER_UNREACHABLE` ve `0` değerlendirici çağrısıdır; 80 vakalık doğrulayıcı aşama başlatılmadı. Bir ek izole teşhis çağrısı, intent zarfının artık kanonik olduğunu fakat modelin dinamik kanıt yolunu ve tam kapsamı üretemediğini gösterdi. Ham `0600` paketler Türkçe inceleme sonrasında silindi. Aggregate dosyasının hazırlanırken doğrulanan SHA-256 değeri `2cb1ff755c72fc5f3124b39d5b96896160a7157a97aa2471995fb4fb7aab8ca3`dür.

## Kaynağa dayalı kanıt v1 smoke kararı

Dondurulmuş sekiz vakalık smoke çalışmasının tamamı dış sandbox içinde yürütüldü. Sekiz aday çağrısının tamamı `INTENT_SCHEMA_INVALID` ile byte-koruyan fail-open oldu; değerlendirici çağrısı yapılmadı ve 80 vakalık doğrulayıcı aşama başlatılmadı. Bir ek, izole aday teşhis çağrısı ortak şema uyumsuzluğunu doğruladı. Ham paketler Türkçe inceleme sonrasında silindi; yalnız strict parser ve secret scan'den geçen sanitize toplu sonuç saklandı. Dosyanın hazırlanırken doğrulanan SHA-256 değeri `b801aaac295d53199737b9573d8278693e929fce0962f708634bea8b9ed39150`dir.

## Prompt-transformation v1 smoke decision

The pre-registered TR/EN prompt-transformation study stopped after its separate eight-case smoke screen. All eight cases transformed and were independently evaluated; structure, language, deterministic safety, forbidden-addition, evaluator coverage, and clearer-or-equal checks passed. The evaluator nevertheless marked one of eight transformations as materially intent-altering (`12.5%`), so the zero-alteration smoke hard gate failed and the 80-case confirmatory run was not executed. The committed artifact contains aggregate evidence and hashes only—no prompt, candidate output, case identifier, credential, or provider error body.

## Evaluator and candidate configuration

- Candidate providers ran with `reasoning: "off"`, `concurrency: 1`,
  `retries: 0` against the same fixed 50-case set.
- The optional model evaluator ran with provider `openai-codex`,
  model `gpt-5.6-sol`, `reasoning: "medium"`,
  `promptVersion: "pi-benchmark-evaluator-v3"`. The evaluator is a
  one-shot call (30 s, no retries, no cache) and is not a human
  review.

## Headline numbers (DeepSeek baseline)

- 49/50 transformed; 1 fail-open (`tr-07`,
  `errorCode: PROVIDER_INVALID_JSON`).
- `structuralPassRate` `0.98` (denominator 50, pass).
- `languagePreservationRate` `1.0` of 49 (pass).
- `deterministicSafetyPassRate` `1.0` of 7 (pass).
- `evaluatorCoverageRate` `1.0` of 49.
- Raw evaluator `evaluatorMaterialIntentAlterationRate` `0.142857`
  of 49 (model signal, threshold `fail`).
- Raw evaluator `evaluatorClearerOrEqualRate` `0.897959` of 49.
- `latencyP50` `8954` ms, `latencyP95` `14227` ms.
- Candidate `totalCostUsd` `0.0127001`.

## Model-assisted technical audit (non-human)

A model-assisted technical audit, explicitly non-human, read the exact
source/candidate evidence from the private hash-bound review bundle.
The bundle was never committed; only these bounded findings remain:

- 6 evaluator false positives: `en-02`, `en-11`, `en-12`, `en-15`,
  `es-08`, `tr-12`.
- 1 confirmed material polarity inversion: `tr-08`.
- 1 fail-open: `tr-07` (`PROVIDER_INVALID_JSON`).

## Request-level intent preservation

For user reporting, request-level intent preservation is defined as
`(50 - confirmed material alterations - fail-open cases) / 50 =
48/50 = 96%`. This is the percentage of requests whose intent was
preserved, not the percentage of meaning inside an individual
sentence. Confirmed material alteration: `tr-08`. Fail-open: `tr-07`.

## Selection rationale

DeepSeek was selected over MiMo for stronger structural coverage
(`0.98` vs `0.92`), better language preservation (`1.0` vs `0.978723`
— MiMo fails the V2 language threshold), fewer fail-opens (1 vs 3),
and roughly 2x lower `latencyP50` (`8954` ms vs `17444` ms). The
DeepSeek model-evaluator raw alteration rate is noisier than MiMo's
(`0.142857` vs `0.06383`), but the model-assisted audit attributes
six of DeepSeek's seven evaluator flags to false positives, leaving
one confirmed material alteration; the audit does not similarly
exonerate MiMo's flags. The selected baseline trades a higher raw
model signal rate for stronger deterministic gates and lower latency.

## Rejected optimization

Two prompt changes were attempted on the DeepSeek profile, then
reverted:

- A general polarity prompt change.
- A Turkish-morphology prompt change targeting `tr-08`.

A full 50-case rerun on the optimized prompt regressed on every
reported metric (`structuralPassRate` 0.98 → 0.94,
`languagePreservationRate` 1.0 → 0.97917, `evaluatorCoverageRate`
1.0 → 0.95833, `evaluatorMaterialIntentAlterationRate` 0.85714 →
0.8125, `evaluatorClearerOrEqualRate` 0.89796 → 0.85417,
`latencyP50` 8954 → 10433). Both changes were reverted. The optimized
rejected report is **not** committed.

## Known limitations

- About 2% confirmed material intent inversion in this sample
  (`tr-08`).
- About 2% fail-open in this sample (`tr-07`).
- Provider and model stochasticity; reruns of the same 50 cases may
  not reproduce the same per-case verdicts, latency, or cost.
- Model-evaluator noise (six of seven DeepSeek flags in this run were
  judged false positives by the non-human model-assisted audit). The
  audit is non-human and bounded.
- No human per-case owner review: the `ownerReview` slot is absent in
  the committed Report V2; the corresponding thresholds are
  `unavailable`.
- The evaluator `materialAlteration` threshold remains `fail` in the
  committed Report V2. Local acceptance is "approved with known
  limitations", not threshold laundering.

## Publication scope

The owner separately authorized the public GitHub `v1.0.0` source
release on 2026-07-21. npm publication remains out of scope. The
artifacts in this directory are bounded baseline evidence; they are
not human review and do not independently authorize another release.
