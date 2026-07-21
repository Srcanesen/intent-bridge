# @srcanesen/intent-bridge

Apache-2.0 Pi extension package for Intent Bridge. It bundles the private core and OpenAI-compatible provider into `dist/index.js`; Pi itself is the only runtime peer.

## Compatibility

- Pi `0.80.10` exactly (the supported and tested host version)
- Node `>=22.23.1`

CI verifies Pi `0.80.10` regularly. Its scheduled latest-Pi check is observational and non-blocking, not a support declaration.

## Install

For v1.1.0, install through Pi:

```bash
pi install npm:@srcanesen/intent-bridge@1.1.0
```

For a local checkout, build first and load the package directory:

```bash
corepack pnpm build
pi -e ./packages/pi-extension
```

Use `/bridge on`; if no usable model is selected, Bridge opens the model picker automatically. `/bridge model` can change the selection later. `/bridge preview` enables review mode, `/bridge preview off` returns to automatic mode, and `/bridge off` disables Bridge. Pi's host runtime owns auth and native transport (OAuth, API key, header, and env providers); the picker lists only available compatible models and stores only provider/model IDs after one validation call. Production forces thinking off and native SDK retry/cache retention off; the Bridge pipeline may make one bounded retry for retryable provider failures. Image-only, invalid-limit, unavailable, and off-unsupported models are excluded. Transformation failures preserve and send the original message with a calm nontechnical notice. Explicit Bridge profiles remain supported through configuration. For a paid latency comparison, run `corepack pnpm benchmark:pi-thinking -- --provider ID --model ID`; do not run it unintentionally.

## Quality review

Configure the `quality` block in the JSON config (global or trusted project layer) — file-only, no CLI control. The default is `enforcement: "observe"`, with `reviewOnHighRisk`, `reviewOnClarification`, and `reviewOnMaterialAskUser` all `true` and `minConfidence: null`. Under observe, a would-review transformation is still injected; the assessment is observable in `/bridge last`, the trace, and the preview, but never blocks delivery. Setting `enforcement: "review"` routes review candidates through the existing preview selector in auto mode, and preserves the original message when no interactive UI is available (the `quality_review_required_no_ui` reason is recorded in the trace). The compiler emits a separate `## Interpreter advisory — not user requirements` section in the compiled task when warranted; it is omitted for clean compact or follow-up output and never appears under user-stated constraints.

## Compiler configuration

The JSON `compiler` config is file-only (global or trusted project layer). `includeOriginalRequest` defaults to `true`; set it to `false` to omit the `## Original user request` heading and fenced body. Normal user input / Pi turn behavior is unchanged.

## Correlation invariant

Pi 0.80.10 provides no stable turn ID shared by input and agent-start events. If an active reservation has the same prompt-and-image-count fingerprint as a new reservation, every active occurrence with that fingerprint is permanently non-injectable: late provider completions are rejected and each matching agent-start receives the original turn with no hidden compiled context. Different fingerprints remain independent. Collision state uses the existing bounded pending/tombstone TTLs and capacities; diagnostics contain only `fingerprint_collision`, the hash, and bounded correlation metadata—never prompt or compiled content.

See the repository README for provider setup, privacy, commands, and troubleshooting.
