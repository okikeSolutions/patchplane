# Security Policy

PatchPlane handles source-control webhooks, authentication, sandbox execution, and secret-bearing server configuration. Please report suspected vulnerabilities privately.

## Reporting a vulnerability

Do not open a public issue for security reports.

Use GitHub's private vulnerability reporting if available for this repository, or contact the maintainers privately through GitHub.

Please include:

- affected component or package,
- reproduction steps or proof of concept,
- expected impact,
- any relevant logs with secrets redacted.

## Secret handling

- Do not commit `.env`, `.env.local`, private keys, API keys, webhook secrets, or provider tokens.
- `patchplane.config.json` is for non-secret project config only.
- `.patchplane/` is for generated local state, logs, cache, and runtime artifacts only.

## Supported versions

PatchPlane is currently pre-1.0 alpha software. Security fixes land on the default branch until versioned releases are established.
