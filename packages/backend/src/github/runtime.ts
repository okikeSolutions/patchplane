import { ManagedRuntime } from 'effect'
import { GitHubBoundaryLive } from './layers'

export const GitHubBoundaryRuntime = ManagedRuntime.make(GitHubBoundaryLive)
