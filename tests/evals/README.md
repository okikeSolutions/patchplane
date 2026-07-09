# PatchPlane eval suites

Black-box evals live outside publishable packages so OSS/package code stays focused while repo-level tests can enforce developer and agent ergonomics.

## CLI friendliness

`tests/evals/cli-friendliness.test.ts` evaluates the built `patchplane` CLI as an external process in temporary repositories.

The suite intentionally uses Effect's Node platform services:

- `@effect/platform-node/NodeChildProcessSpawner`
- `@effect/platform-node/NodeFileSystem`
- `@effect/platform-node/NodePath`
- `effect/unstable/process/ChildProcess`

This keeps process execution, filesystem access, paths, and cleanup inside Effect services while still testing the real packaged CLI entrypoint:

```sh
bun vitest run tests/evals/cli-friendliness.test.ts --project default
```

Current contract dimensions:

- command/help quality
- stdout/stderr discipline
- exit-code correctness
- dry-run mutation safety
- schema/registry consistency
- global `--cwd`
- JSON diagnostics and plugin discovery output

When new CLI ergonomics gaps are found, encode them as `it.effect.fails(...)` first. When implementation catches up, convert the expected-fail case to a normal `it.effect(...)` regression.
