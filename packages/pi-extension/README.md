# @intent-bridge/pi-extension

Apache-2.0 Pi extension package for Intent Bridge. It bundles the private core and OpenAI-compatible provider into `dist/index.js`; Pi itself is the only runtime peer.

## Compatibility

- Pi `0.80.10` exactly (the supported and tested host version)
- Node `>=22.23.1`

CI verifies Pi `0.80.10` regularly. Its scheduled latest-Pi check is observational and non-blocking, not a support declaration.

## Install

Install the public GitHub release:

```bash
pi install git:github.com/Srcanesen/intent-bridge@v1.0.0
```

The npm package is not published. For a local checkout, build first and load the package directory:

```bash
corepack pnpm build
pi -e ./packages/pi-extension
```

Use `/bridge on`; if no usable model is selected, Bridge opens the model picker automatically. `/bridge model` can change the selection later. `/bridge preview` enables review mode, `/bridge preview off` returns to automatic mode, and `/bridge off` disables Bridge. Pi's host runtime owns auth and native transport (OAuth, API key, header, and env providers); the picker lists only available compatible models and stores only provider/model IDs after one validation call. Production forces thinking off and native SDK retry/cache retention off; the Bridge pipeline may make one bounded retry for retryable provider failures. Image-only, invalid-limit, unavailable, and off-unsupported models are excluded. Transformation failures preserve and send the original message with a calm nontechnical notice. Explicit Bridge profiles remain supported through configuration. For a paid latency comparison, run `corepack pnpm benchmark:pi-thinking -- --provider ID --model ID`; do not run it unintentionally.

## Quality review

Configure the `quality` block in the JSON config (global or trusted project layer) — file-only, no CLI control. The default is `enforcement: "observe"`, with `reviewOnHighRisk`, `reviewOnClarification`, and `reviewOnMaterialAskUser` all `true` and `minConfidence: null`. Under observe, a would-review transformation is still injected; the assessment is observable in `/bridge last`, the trace, and the preview, but never blocks delivery. Setting `enforcement: "review"` routes review candidates through the existing preview selector in auto mode, and preserves the original message when no interactive UI is available (the `quality_review_required_no_ui` reason is recorded in the trace). The compiler emits a separate `## Interpreter advisory — not user requirements` section in the compiled task when warranted; it is omitted for clean compact or follow-up output and never appears under user-stated constraints.

## Compiler configuration

The JSON `compiler` config is file-only (global or trusted project layer). `includeOriginalRequest` defaults to `true`; set it to `false` to omit the `## Original user request` heading and fenced body. Normal user input / Pi turn behavior is unchanged.

See the repository README for provider setup, privacy, commands, and troubleshooting.
