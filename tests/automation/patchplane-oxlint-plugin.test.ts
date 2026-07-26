import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RuleTester } from 'oxlint/plugins-dev'
import { rules } from '../../scripts/oxlint/patchplane-plugin.mjs'

type OxlintRule = Parameters<RuleTester['run']>[1]

function rule(name: keyof typeof rules): OxlintRule {
  return rules[name]
}

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const tester = new RuleTester({
  languageOptions: {
    sourceType: 'module',
    parserOptions: { lang: 'ts' },
  },
})

tester.run('no-detached-effect-fork', rule('no-detached-effect-fork'), {
  valid: [
    {
      filename: 'packages/plugins/src/example.ts',
      code: `import { Effect } from 'effect'; program.pipe(Effect.forkScoped)`,
    },
    {
      filename: 'packages/plugins/src/example.test.ts',
      code: `import { Effect } from 'effect'; program.pipe(Effect.forkDetach)`,
    },
  ],
  invalid: [
    {
      filename: 'packages/plugins/src/example.ts',
      code: `import { Effect as Fx } from 'effect'; program.pipe(Fx.forkDetach)`,
      errors: [{ messageId: 'detached' }],
    },
    {
      filename: 'packages/plugins/src/example.ts',
      code: `import { forkDaemon } from 'effect/Effect'; forkDaemon(program)`,
      errors: [{ messageId: 'detached' }],
    },
  ],
})

tester.run('no-effect-promise', rule('no-effect-promise'), {
  valid: [
    {
      filename: 'packages/core/src/example.ts',
      code: `import { Effect } from 'effect'; Effect.tryPromise({ try: () => fetch('/'), catch: String })`,
    },
    {
      filename: 'packages/plugins/src/scripts/live-example.ts',
      code: `import { Effect } from 'effect'; Effect.promise(() => Promise.resolve())`,
    },
  ],
  invalid: [
    {
      filename: 'packages/core/src/example.ts',
      code: `import * as Fx from 'effect/Effect'; Fx.promise(() => fetch('/'))`,
      errors: [{ messageId: 'promise' }],
    },
  ],
})

tester.run('no-throw-in-effect-sync', rule('no-throw-in-effect-sync'), {
  valid: [
    {
      filename: 'packages/cli/src/example.ts',
      code: `import { Effect } from 'effect'; Effect.sync(() => () => { throw new Error('later') })`,
    },
    {
      filename: 'packages/cli/src/example.ts',
      code: `import { Effect } from 'effect'; Effect.try({ try: () => { throw new Error('mapped') }, catch: String })`,
    },
  ],
  invalid: [
    {
      filename: 'packages/cli/src/example.ts',
      code: `import { Effect } from 'effect'; Effect.sync(() => { throw new Error('defect') })`,
      errors: [{ messageId: 'thrown' }],
    },
  ],
})

tester.run('guard-json-parse-in-effect', rule('guard-json-parse-in-effect'), {
  valid: [
    {
      filename: 'apps/client/src/effect/example.ts',
      code: `import { Effect } from 'effect'; Effect.gen(function* () { try { return JSON.parse('{}') } catch { return {} } })`,
    },
    {
      filename: 'apps/client/src/effect/example.ts',
      code: `import { Effect } from 'effect'; const JSON = { parse: () => ({}) }; Effect.gen(function* () { return JSON.parse('{}') })`,
    },
    {
      filename: 'apps/client/src/effect/example.ts',
      code: `import { Effect } from 'effect'; Effect.try({ try: () => JSON.parse('{}'), catch: String })`,
    },
  ],
  invalid: [
    {
      filename: 'apps/client/src/effect/example.ts',
      code: `import { Effect } from 'effect'; Effect.gen(function* () { return JSON.parse('{}') })`,
      errors: [{ messageId: 'parse' }],
    },
  ],
})

tester.run('no-run-sync-outside-entrypoint', rule('no-run-sync-outside-entrypoint'), {
  valid: [
    {
      filename: 'apps/source-control/src/runtime.ts',
      code: `import { Effect } from 'effect'; Effect.runSync(Effect.void)`,
    },
    {
      filename: 'packages/core/src/example.ts',
      code: `import { Effect } from 'effect'; export const program = Effect.void`,
    },
  ],
  invalid: [
    {
      filename: 'apps/source-control/src/github/config.ts',
      code: `import { Effect } from 'effect'; Effect.runSync(Effect.void)`,
      errors: [{ messageId: 'runSync' }],
    },
  ],
})

tester.run('no-ambient-env-in-effect-code', rule('no-ambient-env-in-effect-code'), {
  valid: [
    {
      filename: 'apps/client/src/components/example.ts',
      code: `const value = process.env.API_KEY`,
    },
    {
      filename: 'packages/core/src/example.ts',
      code: `const process = { env: { API_KEY: 'test' } }; const value = process.env.API_KEY`,
    },
    {
      filename: 'packages/cli/src/services/env-file.ts',
      code: `const values = Object.entries(process.env)`,
    },
    {
      filename: 'packages/plugins/src/example.ts',
      code: `const mode = process.env.NODE_ENV`,
    },
  ],
  invalid: [
    {
      filename: 'packages/core/src/example.ts',
      code: `const first = process.env.API_KEY; const second = process.env['OTHER_KEY']`,
      errors: [{ messageId: 'ambient', data: { names: 'API_KEY, OTHER_KEY' } }],
    },
    {
      filename: 'packages/core/src/example.ts',
      code: `const values = Object.entries(process.env)`,
      errors: [{ messageId: 'ambient', data: { names: '<all>' } }],
    },
  ],
})

tester.run('no-synchronous-set-state-in-effect', rule('no-synchronous-set-state-in-effect'), {
  valid: [
    {
      filename: 'apps/client/src/example.tsx',
      code: `import { useEffect, useState } from 'react'; const C = () => { const [value, setValue] = useState(0); useEffect(() => window.addEventListener('change', () => setValue(1)), []); return value }`,
    },
    {
      filename: 'apps/client/src/example.tsx',
      code: `import * as React from 'react'; const C = () => { const [value, setValue] = React.useState(0); return <button onClick={() => setValue(1)}>{value}</button> }`,
    },
    {
      filename: 'apps/client/src/example.tsx',
      code: `import { useEffect, useState } from 'react'; const C = () => { const [value, setValue] = useState(0); useEffect((setValue) => setValue(), []); return value }`,
    },
  ],
  invalid: [
    {
      filename: 'apps/client/src/example.tsx',
      code: `import { useEffect as effect, useState as state } from 'react'; const C = ({ value }) => { const [derived, setDerived] = state(value); effect(() => setDerived(value), [value]); return derived }`,
      errors: [{ messageId: 'synchronous' }],
    },
    {
      filename: 'apps/client/src/example.tsx',
      code: `import * as React from 'react'; const C = () => { const [ready, setReady] = React.useState(false); React.useEffect(() => { if (!ready) setReady(true) }, [ready]); return ready }`,
      errors: [{ messageId: 'synchronous' }],
    },
  ],
})

tester.run('require-effect-cleanup', rule('require-effect-cleanup'), {
  valid: [
    {
      filename: 'apps/client/src/example.tsx',
      code: `import { useEffect } from 'react'; useEffect(() => { const id = setTimeout(run, 10); return () => clearTimeout(id) }, [])`,
    },
    {
      filename: 'apps/client/src/example.tsx',
      code: `import { useEffect } from 'react'; useEffect(() => { window.addEventListener('change', run); return () => window.removeEventListener('change', run) }, [])`,
    },
    {
      filename: 'apps/client/src/example.tsx',
      code: `import { useEffect } from 'react'; useEffect(() => { const cleanup = api.subscribe(run); return cleanup }, [api])`,
    },
  ],
  invalid: [
    {
      filename: 'apps/client/src/example.tsx',
      code: `import { useEffect } from 'react'; useEffect(() => { setInterval(run, 10) }, [])`,
      errors: [{ messageId: 'cleanup' }],
    },
    {
      filename: 'apps/client/src/example.tsx',
      code: `import * as React from 'react'; React.useEffect(() => { api.subscribe(run) }, [api])`,
      errors: [{ messageId: 'cleanup' }],
    },
    {
      filename: 'apps/client/src/example.tsx',
      code: `import { useEffect } from 'react'; useEffect(() => { window.setTimeout(run, 10) }, [])`,
      errors: [{ messageId: 'cleanup' }],
    },
  ],
})

tester.run('no-fetch-in-effect', rule('no-fetch-in-effect'), {
  valid: [
    {
      filename: 'apps/client/src/example.tsx',
      code: `import { useEffect } from 'react'; const fetch = client.fetch; useEffect(() => { void fetch('/data') }, [])`,
    },
    {
      filename: 'apps/client/src/example.tsx',
      code: `const load = () => fetch('/data')`,
    },
  ],
  invalid: [
    {
      filename: 'apps/client/src/example.tsx',
      code: `import { useEffect } from 'react'; useEffect(() => { void fetch('/data') }, [])`,
      errors: [{ messageId: 'fetch' }],
    },
    {
      filename: 'apps/client/src/example.tsx',
      code: `import { useEffect } from 'react'; useEffect(() => { async function load() { await fetch('/data') } void load() }, [])`,
      errors: [{ messageId: 'fetch' }],
    },
  ],
})

describe('Patchplane Oxlint configuration', () => {
  it('loads every custom Effect-native rule', () => {
    const configuredRules = Object.fromEntries(
      Object.keys(rules).map((name) => [`patchplane/${name}`, 'error']),
    )

    expect(JSON.parse(readFileSync('.oxlintrc.json', 'utf8'))).toMatchObject({
      jsPlugins: ['./scripts/oxlint/patchplane-plugin.mjs'],
      rules: configuredRules,
    })
  })
})
