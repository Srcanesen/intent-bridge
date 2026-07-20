# Contributing

Use Node 22 and Corepack: `corepack pnpm install --frozen-lockfile`, then `corepack pnpm check`. Run `corepack pnpm benchmark -- validate-fixtures --cases benchmarks/cases` for fixture changes and `corepack pnpm release:smoke` for packaging changes.

Benchmark fixtures are reviewed, synthetic, and must contain no real credentials or provider output. Keep live provider tests and benchmarks opt-in; do not commit a mock result as a quality baseline.

Keep commits focused, include tests for behavior changes, and describe privacy/security impact in review. Report vulnerabilities privately through GitHub Security Advisories; see [SECURITY.md](SECURITY.md).
