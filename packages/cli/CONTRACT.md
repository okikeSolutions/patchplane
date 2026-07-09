# PatchPlane CLI Contract

PatchPlane CLI is alpha, but the automation contract below is intentional and regression-tested.

## Global flags

- `--cwd <dir>` runs the command as if started in `<dir>`.
- `--config <file>` uses an explicit project config path instead of `patchplane.config.json`.
- `--dotenv <file>` loads an additional dotenv file before command execution. It may be repeated. `--env-file <file>` is accepted as an automation-friendly alias. Existing non-empty process environment values win over file values.

Global path flags may appear before the subcommand:

```sh
patchplane --cwd /repo --dotenv .env.local doctor --json
```

## Stdout and stderr

- Human command output goes to stdout.
- JSON payloads go to stdout.
- Human-mode validation/failure summaries go to stderr.
- JSON mode must not add human prose, ANSI spinners, or progress text to stdout.
- JSON failure commands set a non-zero exit code and keep stderr empty unless the process fails before command execution.

## Exit codes

- `0`: command completed successfully.
- non-zero: validation failed, diagnostics found blocking issues, or an unexpected runtime error occurred.

Commands that emit JSON still use exit codes for automation decisions.

## JSON stability

JSON fields may be added in alpha, but existing top-level field names should not be renamed without a documented migration.

Currently supported JSON commands:

```sh
patchplane init --profile app --dry-run --yes --json
patchplane doctor --json
patchplane env check --json
patchplane plugins list --json
patchplane plugins explain <id> --json
```

## Mutation safety

- `--dry-run` writes no files.
- `init` preserves existing non-empty `.env.local` values.
- `--cwd` scopes repo reads and writes to the selected directory.
- `.patchplane/` is reserved for generated local state, logs, and cache.

## Non-interactive behavior

- `patchplane init --non-interactive` requires explicit setup flags.
- `patchplane init --profile <profile> --yes` is the preferred CI/agent bootstrap form.
- Interactive prompts are only used when stdin and stdout are TTYs.
