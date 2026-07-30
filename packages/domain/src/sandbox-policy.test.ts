import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import { EffectiveSandboxPolicy } from './sandbox-environment'

describe('SandboxPolicy', () => {
  it.effect('decodes effective provider environment readback', () =>
    Effect.gen(function* () {
      const policy = yield* Schema.decodeUnknownEffect(EffectiveSandboxPolicy)({
        lifecycle: {
          ephemeral: true,
          retainAfterRun: false,
          autoStopMinutes: 5,
          autoArchiveMinutes: 0,
          autoDeleteMinutes: 0,
        },
        network: { blockAll: true },
        resources: { cpu: 2, memoryGb: 4, diskGb: 8 },
        environment: {
          sandboxClass: 'linux-container',
          sandboxClassSource: 'trusted-request',
          operatingSystem: 'Linux',
          architecture: 'x86_64',
          image: 'node:22@sha256:immutable',
          target: 'us',
          providerState: 'started',
          public: false,
          linked: false,
          volumeCount: 0,
          observedAt: 1,
        },
      })
      expect(policy.environment?.image).toBe('node:22@sha256:immutable')
    }),
  )

  it.effect('decodes protected source execution policy', () =>
    Effect.gen(function* () {
      const policy = yield* Schema.decodeUnknownEffect(EffectiveSandboxPolicy)({
        lifecycle: { ephemeral: true, retainAfterRun: false },
        network: {},
        resources: {},
        protectedExecution: {
          version: 'linux-v1',
          effectiveUid: 65_534,
          effectiveGid: 65_534,
          noNewPrivileges: true,
          capabilitySetsCleared: true,
          sourceReadOnly: true,
          gitMetadataReadOnly: true,
          privatePidNamespace: true,
          privateNetworkNamespace: true,
          nestedNamespaceCreationBlocked: true,
          descendantsTerminated: true,
        },
        environment: {
          sandboxClass: 'linux-container',
          sandboxClassSource: 'trusted-request',
          operatingSystem: 'Linux',
          architecture: 'x86_64',
          image: 'node:22',
          target: 'us',
          providerState: 'started',
          public: false,
          linked: false,
          volumeCount: 0,
          observedAt: 1,
        },
      })
      expect(policy.protectedExecution?.privatePidNamespace).toBe(true)
    }),
  )

  it.effect('decodes historical protected policy without new attestation', () =>
    Effect.gen(function* () {
      const policy = yield* Schema.decodeUnknownEffect(EffectiveSandboxPolicy)({
        lifecycle: { ephemeral: true, retainAfterRun: false },
        network: {},
        resources: {},
        protectedExecution: {
          version: 'linux-v1',
          effectiveUid: 65_534,
          effectiveGid: 65_534,
          noNewPrivileges: true,
          capabilitySetsCleared: true,
          sourceReadOnly: true,
          gitMetadataReadOnly: true,
          privatePidNamespace: true,
          privateNetworkNamespace: true,
          descendantsTerminated: true,
        },
        environment: {
          sandboxClass: 'linux-container',
          sandboxClassSource: 'trusted-request',
          operatingSystem: 'Linux',
          architecture: 'x86_64',
          image: 'node:22',
          target: 'us',
          providerState: 'started',
          public: false,
          linked: false,
          volumeCount: 0,
          observedAt: 1,
        },
      })
      expect(
        policy.protectedExecution?.nestedNamespaceCreationBlocked,
      ).toBeUndefined()
    }),
  )

  it.effect('rejects unsafe effective environment counts', () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(EffectiveSandboxPolicy)({
        lifecycle: { ephemeral: true, retainAfterRun: false },
        network: {},
        resources: {},
        environment: {
          sandboxClass: 'linux-container',
          sandboxClassSource: 'trusted-request',
          operatingSystem: 'Linux',
          architecture: 'x86_64',
          image: 'node:22',
          target: 'us',
          providerState: 'started',
          public: false,
          linked: false,
          volumeCount: -1,
          observedAt: 1,
        },
      }).pipe(Effect.result)
      expect(Result.isFailure(result)).toBe(true)
    }),
  )
})
