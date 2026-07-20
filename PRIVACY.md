# Privacy

Intent Bridge sends the original user request to the provider endpoint configured by the user. With project context enabled, it may send the project basename, user-maintained summary, and allowlisted instruction text within configured limits. It does not send repository source code by default and excludes known sensitive paths.

Configuration, logs, session ratings, and benchmark files stay local. Metadata logging is the default; full local logging is opt-in and can contain request content. Off disables persistent trace logging. Logs use the configured local retention period and can be deleted from the path shown by `/bridge logs`; configuration can be removed from `INTENT_BRIDGE_HOME` (or the default local directory).

There is no project-controlled telemetry. API keys are environment references, are not included in prompts/logs/exports, and must never be pasted into commands. Intent Bridge cannot control provider-side logging, retention, or training policies; review the selected provider's privacy terms before sending sensitive material. Use `/bridge privacy` to inspect context eligibility.

The opt-in Pi native corpus benchmark can use an explicitly selected second evaluator provider. When both evaluator arguments are supplied, each transformed case sends that provider the original request, source metadata, loaded project context, candidate intent, and compiled task once, without retries. Evaluator identity is post-hoc report metadata and is not included in evaluator input. No evaluator call occurs when those arguments are absent.

An owner may additionally supply an explicit `--review-bundle <file>` only with the evaluator pair. There is no default path or additional evaluator call. This mode-`0600` local file intentionally contains raw source, project-context, intent, and compiled-task evidence captured before evaluation, including evidence when evaluation fails. It is hash-bound to the separately persisted sanitized V2 report and is never printed or written into that report. Treat it as sensitive: never commit it, never pass it through report writing/sanitization, and delete it after copying and completing only its bounded review template in a separate file.

Model-evaluator output is not owner/human review. `benchmark apply-review` is fully local and makes no provider calls. Its separate hash-bound review artifact contains only bounded case/profile identifiers and verdicts, never raw source or candidate content; the final V2 report stores only bounded owner metadata and aggregates.
