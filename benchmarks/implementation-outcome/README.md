# Implementation-outcome A/B benchmark

This separate, expensive V1 benchmark measures repository implementation outcomes:

- **Control:** the original case request is passed unchanged to `session.prompt()`.
- **Treatment:** the same original request is passed unchanged, plus exactly one `before_agent_start` custom message with `customType: intent-bridge.benchmark-task`, the compiled task as content, and `display: false`.

Treatment compiles once per case through `InterpretationPipeline` and `PiCompilerV1`. Source text, intent, compiled text, assistant/thinking text, provider errors, tool arguments/results, raw diffs, credentials, headers, environment data, and absolute paths are transient and are never report fields or stdout output. Reports contain bounded outcomes and aggregates only, use `ImplementationOutcomeReportV1` (not `BenchmarkReportV2`), are strict-parsed again after sanitization, and are written mode `0600`. No winner is declared.

## Offline validation

```bash
corepack pnpm build
corepack pnpm benchmark:implementation-outcome -- validate \
  --cases benchmarks/implementation-outcome/cases.json
```

Validation makes no model or network calls. It strict-parses all cases, copies every template twice, rejects symlinks/path escapes, creates deterministic Git commits with fixed identity/timestamps, verifies revision/tree identity and clean state, and runs baseline validator argv arrays with `shell: false` and a minimal environment. Required task assertions are evaluated after an implementation arm, not as baseline requirements.

## Live run and external containment

Live mode requires both `INTENT_BRIDGE_LIVE_TESTS=1` and `--attestation <file>`. Pi has no built-in sandbox: a temporary cwd and SDK hooks are **not containment**. The attestation only verifies bounded metadata declared by an externally enforced OpenShell/equivalent policy; it does not prove enforcement.

A real sandbox must expose a writable fixture/output root while keeping the source repository and home directory non-writable, and must not mount credentials or the Docker socket. Build the workspace before entering that sandbox; the benchmark command itself does not build or write source artifacts. Network must be denied except for the explicitly declared inference gateway. The attestation is strict JSON:

```json
{
  "version": 1,
  "writableFixtureRoot": "/sandbox/work",
  "policyHash": "<64 lowercase hex characters>",
  "network": {
    "mode": "deny-except-inference-gateway",
    "inferenceHosts": ["gateway.example:443"]
  },
  "process": { "pid": 123, "cwd": "/read-only/source" },
  "sourceRepoWritable": false,
  "homeMounted": false,
  "credentialsMounted": false,
  "dockerSocketMounted": false
}
```

The PID/cwd must match the current process, and `--fixture-root` plus `--out` must remain under `writableFixtureRoot`. Missing, malformed, or incompatible metadata fails with bounded `INVALID_ISOLATION` before model lookup; execution never downgrades to the host.

```bash
INTENT_BRIDGE_LIVE_TESTS=1 corepack pnpm benchmark:implementation-outcome -- run \
  --cases benchmarks/implementation-outcome/cases.json \
  --implementation-provider <exact-provider> --implementation-model <exact-model> \
  --bridge-provider <exact-provider> --bridge-model <exact-model> \
  --thinking medium --seed ib-06-v1 \
  --attestation /sandbox/attestation.json \
  --fixture-root /sandbox/work --out /sandbox/work/report.json
```

Both exact models must be uniquely available; fallback is rejected. Every arm uses a fresh in-memory session/settings instance, explicit fixture cwd, the same `read/bash/edit/write` allowlist, thinking level, timeout policy, and empty resource discovery (no global/project extensions, skills, prompts, settings, or AGENTS files). Tool-call hooks count and block obvious boundary, network, and destructive attempts as defense in depth only.

Clarification observation is a deterministic boolean heuristic over bounded English/Turkish/Spanish clarification phrases; bare `?` punctuation is not sufficient, and no assistant text is retained. Repeated mutation count comes only from repeated `edit`/`write` path calls. Implementation-agent token/cost fields use Pi's session statistics when available and otherwise remain `null`. Response-language safety is `unavailable`. Synthetic attachment metadata is intentionally omitted because the runner has no corresponding image bytes to pass identically to both arms.

## Corpus matrix

| Case | Language | Scenario | Writable scope |
| --- | --- | --- | --- |
| io-01 | en | bug fix | one source file |
| io-02 | tr | empty guard | one source file |
| io-03 | es | normalization | one source file |
| io-04 | en | zero/default semantics | one source file |
| io-05 | tr | test-only addition | one new test |
| io-06 | en | no-behavior refactor | one source file |
| io-07 | es | one-file scope | one source file |
| io-08 | en | no dependency | one source file; package forbidden |
| io-09 | tr | synthetic redaction marker | one source file |
| io-10 | en | path traversal/injection-like text | one source file |
| io-11 | es | two-file feature | two source files |
| io-12 | tr | duplicated contradictory constraints | no file changes; clarification required |
