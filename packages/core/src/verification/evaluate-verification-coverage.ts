import type {
  VerificationCoverageStatus,
  VerificationRequirement,
  VerificationResult,
} from '@patchplane/domain/verification'

export interface VerificationCoverage {
  readonly status: VerificationCoverageStatus
  readonly requiredCount: number
  readonly passedCount: number
  readonly failedRequirementIds: ReadonlyArray<string>
  readonly missingRequirementIds: ReadonlyArray<string>
  readonly consideredResultIds: ReadonlyArray<string>
}

/**
 * Evaluates only durable results bound to the current candidate.
 * Results for older or different candidates are intentionally ignored.
 */
export function evaluateVerificationCoverage(input: {
  readonly candidatePatchSetId: string
  readonly requirements: ReadonlyArray<VerificationRequirement>
  readonly results: ReadonlyArray<VerificationResult>
}): VerificationCoverage {
  const required = input.requirements.filter((requirement) => requirement.required)
  if (required.length === 0) {
    return {
      status: 'not-configured',
      requiredCount: 0,
      passedCount: 0,
      failedRequirementIds: [],
      missingRequirementIds: [],
      consideredResultIds: [],
    }
  }

  const currentResults = input.results.filter(
    (result) => result.candidatePatchSetId === input.candidatePatchSetId,
  )
  const consideredResultIds: Array<string> = []
  const failedRequirementIds: Array<string> = []
  const missingRequirementIds: Array<string> = []
  let passedCount = 0

  for (const requirement of required) {
    const result = latestResultForRequirement(currentResults, requirement.id)
    if (result === undefined) {
      missingRequirementIds.push(requirement.id)
      continue
    }

    consideredResultIds.push(result.id)
    if (result.status === 'failed') {
      failedRequirementIds.push(requirement.id)
      continue
    }

    if (isValidPass(requirement, result)) {
      passedCount += 1
      continue
    }

    missingRequirementIds.push(requirement.id)
  }

  return {
    status: failedRequirementIds.length > 0
      ? 'failed'
      : missingRequirementIds.length > 0
      ? 'incomplete'
      : 'passed',
    requiredCount: required.length,
    passedCount,
    failedRequirementIds,
    missingRequirementIds,
    consideredResultIds,
  }
}

function latestResultForRequirement(
  results: ReadonlyArray<VerificationResult>,
  requirementId: string,
): VerificationResult | undefined {
  return results.reduce<VerificationResult | undefined>((latest, result) => {
    if (result.requirementId !== requirementId) return latest
    if (latest === undefined) return result
    return (result.completedAt ?? result.startedAt) > (latest.completedAt ?? latest.startedAt)
      ? result
      : latest
  }, undefined)
}

function isValidPass(
  requirement: VerificationRequirement,
  result: VerificationResult,
) {
  if (result.status !== 'passed' || result.exitCode !== 0) return false
  if (
    result.candidateDigestAfter === undefined ||
    result.candidateDigestBefore !== result.candidateDigestAfter
  ) {
    return false
  }

  return requirement.requiredArtifactKinds.every((kind) =>
    result.producedArtifactKinds.includes(kind)
  )
}
