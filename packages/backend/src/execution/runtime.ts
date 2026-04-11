import { ManagedRuntime } from 'effect'
import { ExecutionBoundaryLive } from './layers'

export const ExecutionBoundaryRuntime = ManagedRuntime.make(
  ExecutionBoundaryLive,
)
