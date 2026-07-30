import {
  type AcceptanceSnapshot,
  type DecisionPublicationReplayFixture,
  type GitHubInstallationClient,
  type GitHubPublicationInventory,
  convexClient,
  decodeDecisionPublicationReplayFixture,
  getAcceptanceSnapshot,
  getDecisionPublicationReplayFixture,
  getWorkflowForDelivery,
} from './support'

export function assertSnapshot(
  snapshot: AcceptanceSnapshot,
  expectedIncomingHeadSha?: string,
) {
  if (snapshot.workflowStatus !== 'reviewed') {
    const results = snapshot.verificationResults
      .map((result) => `${result.status}:${result.summary ?? 'no-summary'}`)
      .join(',')
    throw new Error(
      `Workflow did not reach reviewed status (${snapshot.workflowStatus}; results=${results || 'none'})`,
    )
  }
  const incoming =
    snapshot.latestCandidatePatchSet?.subjectKind === 'incoming-pull-request'
  if (!incoming && !snapshot.hasRuntimeEvents)
    throw new Error('Generated workflow did not persist Pi runtime events')

  const sandbox = snapshot.latestSandboxExecution
  if (sandbox === undefined) {
    const groupStatuses = snapshot.verificationExecutionGroups
      .map((group) => group.status)
      .join(',')
    const resultStatuses = snapshot.verificationResults
      .map((result) =>
        result.summary === undefined
          ? result.status
          : `${result.status}:${result.summary.slice(0, 256)}`,
      )
      .join(',')
    throw new Error(
      `Workflow did not persist a sandbox execution (groups=${groupStatuses || 'none'}; results=${resultStatuses || 'none'})`,
    )
  }

  const candidate = snapshot.latestCandidatePatchSet
  if (candidate?.status !== 'captured')
    throw new Error('Latest workflow candidate patch was not captured')
  if (!incoming && candidate.createdAt < sandbox.completedAt) {
    throw new Error(
      'Generated candidate patch predates the latest sandbox execution',
    )
  }
  if (incoming) {
    const plan = snapshot.verificationPlans[0]
    if (
      plan === undefined ||
      !/^sha256:[a-f0-9]{64}$/.test(plan.digest) ||
      plan.requiredCount <= 0 ||
      candidate.headSha === undefined ||
      (expectedIncomingHeadSha !== undefined &&
        candidate.headSha !== expectedIncomingHeadSha)
    ) {
      throw new Error(
        'Incoming workflow has no bounded verification plan or exact submitted head identity',
      )
    }
    const planResults = snapshot.verificationResults.filter(
      (item) => item.verificationPlanId === plan.id,
    )
    const planGroups = snapshot.verificationExecutionGroups.filter((group) =>
      planResults.some((result) => result.executionGroupId === group.id),
    )
    const coherentResult = (result: (typeof planResults)[number]) => {
      const group = planGroups.find(
        (candidateGroup) => candidateGroup.id === result.executionGroupId,
      )
      const terminalGroup =
        group !== undefined &&
        ['completed', 'failed', 'blocked', 'cancelled'].includes(group.status)
      if (
        result.candidatePatchSetId !== candidate.id ||
        !terminalGroup ||
        group.sharedState !== false
      ) {
        return false
      }
      if (!result.required) {
        return (
          result.status !== 'queued' &&
          result.status !== 'running' &&
          (group.providerSessionId === result.providerSessionId ||
            (group.providerSessionId === undefined &&
              result.providerSessionId === undefined)) &&
          (group.providerCommandId === result.providerCommandId ||
            (group.providerCommandId === undefined &&
              result.providerCommandId === undefined))
        )
      }
      return (
        result.status === 'passed' &&
        result.sandboxExecutionId !== undefined &&
        snapshot.sandboxExecutions.some(
          (execution) =>
            execution.id === result.sandboxExecutionId &&
            execution.status === 'succeeded' &&
            execution.executionGroupId === group.id &&
            execution.providerSessionId === result.providerSessionId &&
            execution.providerCommandId === result.providerCommandId,
        ) &&
        result.environmentImage !== undefined &&
        result.stdoutCaptureStatus === 'captured' &&
        result.stderrCaptureStatus === 'captured' &&
        result.cleanupStatus === 'deleted' &&
        result.artifactIds.length >= 2 &&
        result.artifactIds.every((id) =>
          snapshot.evidenceArtifacts.some((artifact) => artifact.id === id),
        ) &&
        group.status === 'completed' &&
        group.sandboxId !== undefined &&
        group.providerSessionId !== undefined &&
        group.providerSessionId === result.providerSessionId &&
        group.providerCommandId !== undefined &&
        group.providerCommandId === result.providerCommandId
      )
    }
    const requiredResults = planResults.filter((item) => item.required)
    if (
      plan.totalCount <= 0 ||
      plan.requiredCount > plan.totalCount ||
      planResults.length !== plan.totalCount ||
      planGroups.length !== plan.totalCount ||
      planResults.filter((item) => item.required).length !==
        plan.requiredCount ||
      requiredResults.some((item) => item.status !== 'passed') ||
      planResults.some((item) => !coherentResult(item)) ||
      new Set(planResults.map((item) => item.requirementId)).size !==
        plan.totalCount ||
      new Set(planResults.map((item) => item.executionGroupId)).size !==
        plan.totalCount ||
      new Set(requiredResults.map((item) => item.sandboxExecutionId)).size !==
        plan.requiredCount
    ) {
      throw new Error(
        'Incoming Linux verification lacks coherent plan/group/environment/log/artifact/cleanup evidence',
      )
    }
  }

  const review = snapshot.latestReviewRun
  if (review?.status !== 'completed')
    throw new Error('Latest workflow review did not complete')
  if (
    review.sandboxExecutionId !== sandbox.id ||
    review.candidatePatchSetId !== candidate.id
  ) {
    throw new Error(
      'Latest review is not linked to the latest sandbox and candidate patch',
    )
  }

  const policy = snapshot.latestPolicyDecision
  if (policy === undefined)
    throw new Error('Workflow did not persist a policy decision')
  if (policy.reviewRunId !== review.id) {
    throw new Error('Latest policy decision is not linked to the latest review')
  }
  if (policy.createdAt < review.createdAt) {
    throw new Error('Policy decision predates the latest review')
  }
  if (!snapshot.hasProvenanceEvents)
    throw new Error('Workflow did not persist provenance')

  const diff = snapshot.evidenceArtifacts.find(
    (artifact) => artifact.id === candidate.diffArtifactId,
  )
  if (
    diff?.kind !== 'diff' ||
    diff.sizeBytes < 1 ||
    !/^[a-f0-9]{64}$/.test(diff.sha256)
  ) {
    throw new Error(
      'Latest candidate does not reference a non-empty hashed diff artifact',
    )
  }
}

export function latestPublishedHumanDecision(snapshot: AcceptanceSnapshot) {
  const latestDecision = snapshot.humanDecisions.reduce<
    AcceptanceSnapshot['humanDecisions'][number] | undefined
  >(
    (latest, decision) =>
      latest === undefined || decision.decidedAt > latest.decidedAt
        ? decision
        : latest,
    undefined,
  )
  if (latestDecision === undefined) return undefined
  return snapshot.publicationResults.some(
    (publication) =>
      publication.status === 'published' &&
      publication.externalId !== undefined &&
      publication.idempotencyKey?.startsWith(`${latestDecision.id}:`) === true,
  )
    ? latestDecision
    : undefined
}

export async function waitForWorkflowDelivery(
  deliveryId: string,
  systemSecret: string,
) {
  const deadline =
    Date.now() + Number(process.env.PATCHPLANE_SMOKE_TIMEOUT_MS ?? 600_000)
  while (Date.now() < deadline) {
    const result = await convexClient().query(getWorkflowForDelivery, {
      systemSecret,
      deliveryId,
    })
    if (result.workflowRunId !== undefined) return result.workflowRunId
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error('Queued GitHub delivery did not create a workflow attempt')
}

export async function readAcceptanceSnapshot(
  workflowRunId: string,
  systemSecret: string,
  expectedIncomingHeadSha?: string,
) {
  const deadline =
    Date.now() + Number(process.env.PATCHPLANE_SMOKE_TIMEOUT_MS ?? 600_000)
  while (true) {
    const snapshot = await convexClient().query(getAcceptanceSnapshot, {
      systemSecret,
      workflowRunId,
    })
    if (
      snapshot.workflowStatus === 'reviewed' ||
      snapshot.workflowStatus === 'failed' ||
      Date.now() >= deadline
    ) {
      assertSnapshot(snapshot, expectedIncomingHeadSha)
      return snapshot
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
}

export async function readReplayFixture(
  workflowRunId: string,
  humanDecisionId: string,
  systemSecret: string,
) {
  const value = await convexClient().query(
    getDecisionPublicationReplayFixture,
    { systemSecret, workflowRunId, humanDecisionId },
  )
  return decodeDecisionPublicationReplayFixture(value)
}

export function expectedPublicationTargets(
  fixture: DecisionPublicationReplayFixture,
) {
  const ref = fixture.workflowStart.promptRequest.externalRef
  const targets: Array<'issue-comment' | 'check-run'> = []
  if (ref?.issueNumber !== undefined) targets.push('issue-comment')
  if (
    fixture.candidateHeadSha !== undefined ||
    ref?.pullRequestHeadSha !== undefined
  ) {
    targets.push('check-run')
  }
  if (targets.length === 0) {
    throw new Error('Decision has no GitHub publication targets')
  }
  return targets
}

export function publicationKey(
  decisionId: string,
  kind: 'issue-comment' | 'check-run',
) {
  return `${decisionId}:${kind}`
}

export function assertPublishedFixture(
  fixture: DecisionPublicationReplayFixture,
) {
  if (
    fixture.humanDecision.idempotencyKey === undefined ||
    fixture.humanDecision.idempotencyKey.length === 0
  ) {
    throw new Error('Human decision has no durable idempotency key')
  }
  if (
    fixture.humanDecision.workflowRunId !== fixture.workflowStart.workflowRun.id
  ) {
    throw new Error('Human decision does not belong to workflow')
  }

  const expected = expectedPublicationTargets(fixture)
  const byKey = new Map(
    fixture.publicationResults.flatMap((publication) =>
      publication.idempotencyKey === undefined
        ? []
        : [[publication.idempotencyKey, publication] as const],
    ),
  )
  for (const kind of expected) {
    const result = byKey.get(publicationKey(fixture.humanDecision.id, kind))
    if (
      result === undefined ||
      result.kind !== kind ||
      result.status !== 'published' ||
      result.externalId === undefined
    ) {
      throw new Error(`Expected ${kind} is not durably published`)
    }
  }
  if (byKey.size !== expected.length) {
    throw new Error('Replay fixture contains unexpected publication results')
  }
  return expected
}

function durablePublicationIds(fixture: DecisionPublicationReplayFixture) {
  return Object.fromEntries(
    fixture.publicationResults.map((publication) => [
      publication.idempotencyKey,
      {
        kind: publication.kind,
        status: publication.status,
        externalId: publication.externalId,
      },
    ]),
  )
}

export function githubCoordinates(fixture: DecisionPublicationReplayFixture) {
  const ref = fixture.workflowStart.promptRequest.externalRef
  if (
    ref?.repositoryProvider !== 'github' ||
    ref.repositoryInstallationId === undefined ||
    ref.repositoryOwner === undefined ||
    ref.repositoryName === undefined
  ) {
    throw new Error(
      'Replay fixture has no durable GitHub repository coordinates',
    )
  }
  const installationId = Number(ref.repositoryInstallationId)
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw new Error('Replay fixture has an invalid GitHub installation ID')
  }
  return {
    installationId,
    owner: ref.repositoryOwner,
    repositoryName: ref.repositoryName,
    issueNumber: ref.issueNumber,
    headSha: fixture.candidateHeadSha ?? ref.pullRequestHeadSha,
  }
}

function issueCommentMarker(idempotencyKey: string) {
  return `<!-- patchplane-publication:${encodeURIComponent(idempotencyKey)} -->`
}

export async function readGitHubPublicationInventory(
  octokit: GitHubInstallationClient,
  fixture: DecisionPublicationReplayFixture,
): Promise<GitHubPublicationInventory> {
  const coordinates = githubCoordinates(fixture)
  const decisionId = fixture.humanDecision.id
  const issueComment =
    coordinates.issueNumber === undefined
      ? []
      : (
          await octokit.paginate(octokit.rest.issues.listComments, {
            owner: coordinates.owner,
            repo: coordinates.repositoryName,
            issue_number: coordinates.issueNumber,
            per_page: 100,
          })
        )
          .filter((comment) =>
            comment.body?.includes(
              issueCommentMarker(publicationKey(decisionId, 'issue-comment')),
            ),
          )
          .map((comment) => String(comment.id))

  const checkRun =
    coordinates.headSha === undefined
      ? []
      : (
          await octokit.paginate(octokit.rest.checks.listForRef, {
            owner: coordinates.owner,
            repo: coordinates.repositoryName,
            ref: coordinates.headSha,
            check_name: 'PatchPlane Review',
            filter: 'all',
            per_page: 100,
          })
        )
          .filter(
            (check) =>
              check.external_id === publicationKey(decisionId, 'check-run'),
          )
          .map((check) => String(check.id))

  return { issueComment, checkRun }
}

export function assertGitHubPublicationReadback(
  fixture: DecisionPublicationReplayFixture,
  inventory: GitHubPublicationInventory,
) {
  const expected = assertPublishedFixture(fixture)
  for (const kind of expected) {
    const ids =
      kind === 'issue-comment' ? inventory.issueComment : inventory.checkRun
    const durable = fixture.publicationResults.find(
      (publication) =>
        publication.idempotencyKey ===
        publicationKey(fixture.humanDecision.id, kind),
    )
    if (
      ids.length !== 1 ||
      durable?.externalId === undefined ||
      ids[0] !== durable.externalId
    ) {
      throw new Error(
        `GitHub ${kind} readback did not match its durable external ID`,
      )
    }
  }
}

function haveSameIds(
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
) {
  return (
    before.length === after.length && before.every((id) => after.includes(id))
  )
}

export function assertIdenticalReplayState(
  beforeFixture: DecisionPublicationReplayFixture,
  afterFixture: DecisionPublicationReplayFixture,
  beforeInventory: GitHubPublicationInventory,
  afterInventory: GitHubPublicationInventory,
) {
  if (
    JSON.stringify(durablePublicationIds(beforeFixture)) !==
    JSON.stringify(durablePublicationIds(afterFixture))
  ) {
    throw new Error('Durable publication IDs changed during replay')
  }
  if (
    !haveSameIds(beforeInventory.issueComment, afterInventory.issueComment) ||
    !haveSameIds(beforeInventory.checkRun, afterInventory.checkRun)
  ) {
    throw new Error('GitHub publication IDs or counts changed during replay')
  }
}
