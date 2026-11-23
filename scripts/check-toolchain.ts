import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const EXPECTED_EFFECT_TSGO_VERSION = '0.73.2'
const EXPECTED_TSRS_VERSION = '7.1.0-beta.tsrs3'

const root = resolve(import.meta.dirname, '..')
const effectTsgoBin = resolve(root, 'node_modules/.bin/effect-tsgo')

const output = execFileSync(
  effectTsgoBin,
  [`tsrs@${EXPECTED_TSRS_VERSION}`, '--version'],
  { cwd: root, encoding: 'utf8' },
).trim()

const expectedToken = `effect-tsgo.${EXPECTED_EFFECT_TSGO_VERSION}`
const expectedTsrs = `tsrs ${EXPECTED_TSRS_VERSION}`

if (!output.includes(expectedToken) || !output.includes(expectedTsrs)) {
  process.stderr.write(
    `Toolchain mismatch: expected "${expectedToken}" and "${expectedTsrs}", got "${output}"\n`,
  )
  process.exit(1)
}

process.stdout.write(`Verified toolchain: ${output}\n`)
