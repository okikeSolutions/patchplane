#!/usr/bin/env bun
export {
  type AcceptanceSnapshot,
  decodeDecisionPublicationReplayFixture,
} from './live-trust-loop/support'
export {
  assertSnapshot,
  latestPublishedHumanDecision,
  assertGitHubPublicationReadback,
} from './live-trust-loop/publication'
export { orchestrate } from './live-trust-loop/orchestration'

import { orchestrate } from './live-trust-loop/orchestration';

if (import.meta.main) {
  process.exitCode = (await orchestrate()) ? 0 : 1
}
