# Telemetry data policy

PatchPlane uses Sentry for operational debugging. Sentry is an external data-egress boundary and is never a provenance or Patch Report evidence store.

## Default rule

Telemetry is deny-by-default. Only bounded metadata needed to locate and correlate an operational failure may leave PatchPlane. Full prompts, patches, runtime output, provider responses, and evidence remain in their designated PatchPlane stores under the applicable retention policy.

`sendDefaultPii: false` is required on every Sentry SDK, but it is not sufficient by itself. Every browser, Effect, and Cloudflare Sentry client must also use PatchPlane's complete deny-by-default `makeSentryDataCollection()` configuration, the shared 64-breadcrumb limit, and PatchPlane's event, log, metric, span, and breadcrumb sanitizers. Provider integrations that collect request bodies independently of Sentry's general data-collection options must be disabled explicitly.

## Allowed metadata

The sanitizers may retain bounded values in these categories:

- correlation identifiers: trace, root/attempt workflow, runtime session, sandbox execution, candidate patch set, verification requirement, review, policy, human decision, and publication IDs;
- stable operation, plugin, critical-path stage, publication kind, and typed error category/code;
- status, provider, platform, architecture, counts, and durations;
- HTTP method, status code, and URL origin plus a normalized `/:path` placeholder without original path segments, credentials, query parameters, or fragments;
- deployment environment and release identity;
- Sentry-required event, stack-frame, runtime, browser, operating-system, and trace metadata after sanitization.

Allowed metadata must still be recursively bounded by depth, collection size, and string length. Values matching common credential formats are redacted even when their field is otherwise allowed.

## Prohibited content

The following content must not be sent through Sentry events, logs, metrics, spans, breadcrumbs, request context, tags, or custom context:

- authorization, cookie, session, OAuth, password, private-key, API-key, token, or other credential material;
- user prompts or rerun instructions;
- patches, diffs, source excerpts, raw repository or file paths, command text, stdout/stderr, Pi JSONL, or other runtime output;
- webhook/request bodies, Sentry attachments, artifact bodies, screenshots, test reports, or provider response bodies;
- URL credentials, query parameters, and fragments;
- arbitrary user identity or application `extra` values;
- raw `Cause.pretty` output or arbitrary exception messages.

Exception types and sanitized stack locations may remain for grouping and diagnosis. Exception values are replaced with a stable safe summary. Stack source context and captured local variables are removed.

## Logs and breadcrumbs

Sentry logs are opt-in. A log must carry PatchPlane's telemetry-policy marker and use allowlisted attributes. Routine Effect logs and metrics remain local and must not be registered directly with Sentry's Effect logger or metrics layers; unmarked logs are also dropped by the transport hook as defense in depth. Metrics are dropped unless their name is in the fixed PatchPlane metric allowlist. Local logging remains separately configured and must still follow the repository's secret-handling rules.

Explicit critical-path breadcrumbs use stable `patchplane.*` categories and bounded stage names. They must be buffered in a request/workflow-local telemetry scope and attached only to an error captured in that same scope; concurrent correlation scopes must never share breadcrumbs. Automatic browser breadcrumbs may retain safe navigation/request metadata, but arbitrary messages and non-allowlisted data are filtered.

## Errors and expected outcomes

Unexpected operational failures should create an actionable issue with safe correlation metadata. Validation rejection, authorization denial, duplicate delivery, idempotent replay, policy rejection, and incomplete evidence are expected product outcomes unless an invariant fails; they should not create noisy duplicate issues.

Telemetry sanitization is best-effort operational protection, not permission to put sensitive values into telemetry APIs. Callers must provide PatchPlane-owned identifiers and typed error codes instead of raw payloads. Free-form operation names, event names, metric names, exception types, and path segments are normalized to stable PatchPlane placeholders before transport.

## Verification

Automated verification must use synthetic sentinel secrets, diff bodies, and repository paths in every supported Sentry payload shape and assert that no sentinel reaches transport-bound events, logs, metrics, spans, breadcrumbs, URLs, or stack context. Architecture checks must also prevent diff surfaces from importing telemetry or analytics transports directly. Deployed deliberate-failure checks must use non-sensitive test values only. Direct sanitizer tests are necessary but do not satisfy this requirement until SDK transport-bound coverage also passes.
