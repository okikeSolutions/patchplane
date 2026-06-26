import { Option, Redacted } from 'effect'
import type { SandboxPolicy } from '@patchplane/domain/sandbox-policy'
import {
  DAYTONA_DEFAULT_AUTO_ARCHIVE_MINUTES,
  DAYTONA_DEFAULT_AUTO_STOP_MINUTES,
  type DaytonaConfig,
} from './DaytonaConfig'

function optionValue<A>(option: Option.Option<A>) {
  return Option.isSome(option) ? option.value : undefined
}

export function toDaytonaClientConfig(config: DaytonaConfig) {
  const apiUrl = optionValue(config.apiUrl)
  const target = optionValue(config.target)

  return {
    apiKey: Redacted.value(config.apiKey),
    ...(apiUrl === undefined ? {} : { apiUrl }),
    ...(target === undefined ? {} : { target }),
  }
}

function daytonaResourceOptions(config: DaytonaConfig) {
  return {
    cpu: optionValue(config.resourceCpu),
    memory: optionValue(config.resourceMemory),
    disk: optionValue(config.resourceDisk),
  }
}

function toDaytonaResources(config: DaytonaConfig) {
  const { cpu, memory, disk } = daytonaResourceOptions(config)

  if (cpu === undefined && memory === undefined && disk === undefined) {
    return undefined
  }

  return {
    ...(cpu === undefined ? {} : { cpu }),
    ...(memory === undefined ? {} : { memory }),
    ...(disk === undefined ? {} : { disk }),
  }
}

export function shouldRetainDaytonaSandboxes(config: DaytonaConfig) {
  return optionValue(config.retainSandboxes) === true
}

export function toSandboxPolicy(config: DaytonaConfig, input: {
  readonly timeoutSeconds?: number | undefined
} = {}): SandboxPolicy {
  const retainSandboxes = shouldRetainDaytonaSandboxes(config)
  const networkBlockAll = optionValue(config.networkBlockAll)
  const networkAllowList = optionValue(config.networkAllowList)
  const { cpu, memory, disk } = daytonaResourceOptions(config)

  return {
    lifecycle: {
      ephemeral: !retainSandboxes,
      retainAfterRun: retainSandboxes,
      autoStopMinutes: DAYTONA_DEFAULT_AUTO_STOP_MINUTES,
      autoArchiveMinutes: DAYTONA_DEFAULT_AUTO_ARCHIVE_MINUTES,
      autoDeleteMinutes: retainSandboxes ? -1 : 0,
    },
    network: {
      ...(networkBlockAll === undefined ? {} : { blockAll: networkBlockAll }),
      ...(networkAllowList === undefined ? {} : { allowList: networkAllowList }),
    },
    resources: {
      ...(cpu === undefined ? {} : { cpu }),
      ...(memory === undefined ? {} : { memoryGb: memory }),
      ...(disk === undefined ? {} : { diskGb: disk }),
    },
    ...(input.timeoutSeconds === undefined ? {} : { timeoutSeconds: input.timeoutSeconds }),
  }
}

export function toDaytonaCreateSandboxParams(config: DaytonaConfig, input: {
  readonly traceId: string
  readonly repositoryFullName: string
  readonly envVars?: Record<string, string> | undefined
}) {
  const resources = toDaytonaResources(config)
  const retainSandboxes = shouldRetainDaytonaSandboxes(config)
  const networkBlockAll = optionValue(config.networkBlockAll)
  const networkAllowList = optionValue(config.networkAllowList)

  return {
    language: 'typescript',
    ephemeral: !retainSandboxes,
    autoStopInterval: DAYTONA_DEFAULT_AUTO_STOP_MINUTES,
    autoArchiveInterval: DAYTONA_DEFAULT_AUTO_ARCHIVE_MINUTES,
    ...(retainSandboxes ? { autoDeleteInterval: -1 } : {}),
    ...(networkBlockAll === undefined ? {} : { networkBlockAll }),
    ...(networkAllowList === undefined ? {} : { networkAllowList }),
    ...(resources === undefined ? {} : { resources }),
    ...(input.envVars === undefined ? {} : { envVars: input.envVars }),
    labels: {
      app: 'patchplane',
      traceId: input.traceId,
      repository: input.repositoryFullName,
    },
  }
}
