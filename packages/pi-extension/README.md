# @intent-bridge/pi-extension

Apache-2.0 Pi extension package for Intent Bridge. It bundles the private core and OpenAI-compatible provider into `dist/index.js`; Pi itself is the only runtime peer.

## Compatibility

- Pi `0.80.10` or compatible host API
- Node `>=22.23.1`

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

See the repository README for provider setup, privacy, commands, and troubleshooting.
