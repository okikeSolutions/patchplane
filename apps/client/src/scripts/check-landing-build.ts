import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const outputDirectory = resolve(import.meta.dirname, '../../dist/client')
const requiredFiles = [
  '404.html',
  '_headers',
  '_redirects',
  'de/index.html',
  'en/index.html',
] as const
const forbiddenText = [
  'WORKOS_API_KEY',
  'WORKOS_CLIENT_ID',
  'WORKOS_COOKIE_PASSWORD',
  'VITE_CONVEX_URL',
  'CONVEX_URL',
  'api.workos.com',
  'convex.cloud',
  '/api/auth',
  '/api/github',
  '/api/artifacts',
  '/app/workflows',
  'AuthKitProvider',
  'ConvexProvider',
  'setThemeServerFn',
] as const

function fail(message: string): never {
  throw new Error(`Landing build check failed: ${message}`)
}

function filesIn(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? filesIn(path) : [path]
  })
}

for (const file of requiredFiles) {
  if (!existsSync(join(outputDirectory, file))) {
    fail(`missing ${file}`)
  }
}

for (const file of ['de/index.html', 'en/index.html']) {
  const html = readFileSync(join(outputDirectory, file), 'utf8')
  if (!html.includes('data-testid="shader-loader"')) {
    fail(`${file} does not render the shader loader before hydration`)
  }
}

const files = filesIn(outputDirectory)
const unexpectedHtml = files
  .map((file) => relative(outputDirectory, file))
  .filter(
    (file) =>
      file.endsWith('.html') &&
      file !== '404.html' &&
      file !== 'de/index.html' &&
      file !== 'en/index.html',
  )

if (unexpectedHtml.length > 0) {
  fail(`unexpected HTML routes: ${unexpectedHtml.join(', ')}`)
}

for (const file of files) {
  if (!/\.(?:css|html|js|json|txt)$/.test(file)) continue
  const source = readFileSync(file, 'utf8')
  const forbidden = forbiddenText.find((text) => source.includes(text))
  if (forbidden !== undefined) {
    fail(`${relative(outputDirectory, file)} contains ${forbidden}`)
  }
}

console.log(
  `Landing build verified: ${requiredFiles.length} required files, ${files.length} total files, no private routes or auth/backend configuration.`,
)
