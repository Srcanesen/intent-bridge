# Security policy

This release candidate is supported on a best-effort basis while it is locally prepared. Do not file public issues for credentials, vulnerabilities, or sensitive logs. Use the repository's **GitHub Security Advisory** private reporting path and include minimal reproduction details with secrets removed.

Maintainers will acknowledge reports when triaged and coordinate a private fix before disclosure when practical. There is no published support SLA or invented contact address.

`scan:secrets` scans tracked source and tests. It excludes only `packages/pi-extension/dist/index.js`, a deterministic generated bundle derived from scanned source; release smoke separately verifies that bundle's contents and imports.
