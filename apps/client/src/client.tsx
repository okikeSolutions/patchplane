import { StartClient } from '@tanstack/react-start/client'
import { StrictMode, startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { initializeClientInstrumentation } from './instrument-client-runtime'
import { installVitePreloadErrorRecovery } from './lib/vite-preload-recovery'

initializeClientInstrumentation()
installVitePreloadErrorRecovery()
startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  )
})
