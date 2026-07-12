const requiredEnv = [
  'GITHUB_APP_ID',
  'GITHUB_PRIVATE_KEY',
  'GITHUB_WEBHOOK_SECRET',
  'CONVEX_URL',
  'PATCHPLANE_SYSTEM_INGESTION_SECRET',
] as const

function env(name: string) {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : undefined
}

function baseUrlFromArgs() {
  const explicit = process.argv.find((arg) => arg.startsWith('--base-url='))
    ?.slice('--base-url='.length)
  return explicit ?? env('PATCHPLANE_PUBLIC_APP_URL')
}

function installUrl() {
  const explicit = env('PATCHPLANE_GITHUB_APP_INSTALL_URL')
  if (explicit !== undefined) {
    return explicit
  }

  const slug = env('PATCHPLANE_GITHUB_APP_SLUG')
  return slug === undefined
    ? undefined
    : `https://github.com/apps/${slug}/installations/new`
}

async function head(url: string) {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    return { ok: response.ok, status: response.status, statusText: response.statusText }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: error instanceof Error ? error.message : String(error),
    }
  }
}

async function main() {
  const baseUrl = baseUrlFromArgs()
  const missing = requiredEnv.filter((name) => env(name) === undefined)
  const missingInstall = installUrl() === undefined

  console.log('\npatchplane hosted GitHub App smoke checklist')
  console.log('================================================')

  if (missing.length > 0 || missingInstall) {
    console.log('\nMissing required environment:')
    for (const name of missing) {
      console.log(`- ${name}`)
    }
    if (missingInstall) {
      console.log('- PATCHPLANE_GITHUB_APP_SLUG or PATCHPLANE_GITHUB_APP_INSTALL_URL')
    }
  }

  if (baseUrl === undefined) {
    console.log('\nPass --base-url=https://<ngrok-host> or set PATCHPLANE_PUBLIC_APP_URL.')
    process.exitCode = 1
    console.log('\n')
    return
  }

  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
  const webhookUrl = (env('PATCHPLANE_SOURCE_CONTROL_WORKER_URL') ?? normalizedBaseUrl).replace(/\/$/, '') + '/api/github/webhook'
  const setupUrl = `${normalizedBaseUrl}/api/github/install/callback`
  const connectUrl = `${normalizedBaseUrl}/api/github/install/start?returnPathname=/app`

  console.log('\nConfigure the GitHub App with:')
  console.log(`- Webhook URL: ${webhookUrl}`)
  console.log(`- Setup URL:   ${setupUrl}`)
  console.log('- Webhook events: Pull request, Issues, Issue comments')
  console.log('- Repository permissions: Metadata read, Contents read, Pull requests read, Issues write')

  console.log('\nSmoke flow:')
  console.log(`1. Open app and sign in: ${normalizedBaseUrl}/app`)
  console.log(`2. Start installation:   ${connectUrl}`)
  console.log('3. Select one real test repository on GitHub.')
  console.log('4. Confirm redirect back to /app?github=connected.')
  console.log('5. Open or synchronize a PR in the selected repository.')
  console.log('6. Confirm /api/github/webhook returns 202 in the ngrok/GitHub delivery log.')
  console.log('7. Confirm the app workflow queue shows the new external workflow.')
  console.log('8. Confirm a patchplane sandbox trust report comment appears on the PR.')

  const result = await head(webhookUrl)
  console.log('\nReachability check:')
  console.log(`- HEAD ${webhookUrl} -> ${result.status} ${result.statusText}`)
  if (result.status === 404) {
    console.log('  Note: HEAD may be 404 for method-limited routes. If this is an ngrok error page, restart ngrok and update the GitHub App URLs.')
  }
  if (result.status === 0) {
    process.exitCode = 1
  }

  console.log('\n')
}

void main()
