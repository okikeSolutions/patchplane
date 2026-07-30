import { lifecycleFunctions } from './workflowStarts/lifecycle'
import { runtimeEvidenceFunctions } from './workflowStarts/runtimeEvidence'
import { candidatesFunctions } from './workflowStarts/candidates'
import { verificationFunctions } from './workflowStarts/verification'
import { reviewPublicationFunctions } from './workflowStarts/reviewPublication'
import { deliveriesFunctions } from './workflowStarts/deliveries'
import { readModelsFunctions } from './workflowStarts/readModels'

export const create = lifecycleFunctions.create
export const createFromExternalIntake =
  lifecycleFunctions.createFromExternalIntake
export const createRerun = lifecycleFunctions.createRerun
export const getWorkflowExecutionFixture =
  lifecycleFunctions.getWorkflowExecutionFixture
export const claimWorkflowExecution = lifecycleFunctions.claimWorkflowExecution
export const markWorkflowExecutionFailed =
  lifecycleFunctions.markWorkflowExecutionFailed
export const recordRuntimeEvents = runtimeEvidenceFunctions.recordRuntimeEvents
export const recordRuntimeSessionStarted =
  runtimeEvidenceFunctions.recordRuntimeSessionStarted
export const markRuntimeSessionStatus =
  runtimeEvidenceFunctions.markRuntimeSessionStatus
export const getActiveRuntimeSession =
  runtimeEvidenceFunctions.getActiveRuntimeSession
export const getEvidenceArtifact = runtimeEvidenceFunctions.getEvidenceArtifact
export const recordEvidenceArtifact =
  runtimeEvidenceFunctions.recordEvidenceArtifact
export const recordSandboxExecution =
  runtimeEvidenceFunctions.recordSandboxExecution
export const authorizeRuntimeControl =
  runtimeEvidenceFunctions.authorizeRuntimeControl
export const getCandidatePatchSetForWorkflow =
  candidatesFunctions.getCandidatePatchSetForWorkflow
export const claimCandidateFreeze = candidatesFunctions.claimCandidateFreeze
export const releaseCandidateFreeze = candidatesFunctions.releaseCandidateFreeze
export const failCandidateFreeze = candidatesFunctions.failCandidateFreeze
export const claimIncomingDispatch = candidatesFunctions.claimIncomingDispatch
export const startIncomingDispatch = candidatesFunctions.startIncomingDispatch
export const expireStartedIncomingDispatch =
  candidatesFunctions.expireStartedIncomingDispatch
export const validateIncomingDispatch =
  candidatesFunctions.validateIncomingDispatch
export const recordCandidatePatchSet =
  candidatesFunctions.recordCandidatePatchSet
export const recordVerificationPlan =
  verificationFunctions.recordVerificationPlan
export const recordVerificationRequirement =
  verificationFunctions.recordVerificationRequirement
export const startIncomingVerificationPlan =
  verificationFunctions.startIncomingVerificationPlan
export const claimVerificationExecutionGroup =
  verificationFunctions.claimVerificationExecutionGroup
export const expireIncomingVerificationDispatch =
  verificationFunctions.expireIncomingVerificationDispatch
export const startVerificationExecutionGroup =
  verificationFunctions.startVerificationExecutionGroup
export const recordVerificationExecutionCommand =
  verificationFunctions.recordVerificationExecutionCommand
export const expireVerificationExecutionGroup =
  verificationFunctions.expireVerificationExecutionGroup
export const failVerificationExecutionGroup =
  verificationFunctions.failVerificationExecutionGroup
export const getVerificationExecutionState =
  verificationFunctions.getVerificationExecutionState
export const recordVerificationResult =
  verificationFunctions.recordVerificationResult
export const recordReviewRun = reviewPublicationFunctions.recordReviewRun
export const recordReviewFinding =
  reviewPublicationFunctions.recordReviewFinding
export const recordPolicyDecision =
  reviewPublicationFunctions.recordPolicyDecision
export const recordPublicationResult =
  reviewPublicationFunctions.recordPublicationResult
export const recordProvenanceEvent =
  reviewPublicationFunctions.recordProvenanceEvent
export const recordHumanDecision =
  reviewPublicationFunctions.recordHumanDecision
export const recordQueuedGitHubDelivery =
  deliveriesFunctions.recordQueuedGitHubDelivery
export const claimStaleGitHubDeliveries =
  deliveriesFunctions.claimStaleGitHubDeliveries
export const getGitHubDeliveryReceipt =
  deliveriesFunctions.getGitHubDeliveryReceipt
export const claimGitHubDeliveryProcessing =
  deliveriesFunctions.claimGitHubDeliveryProcessing
export const releaseGitHubDeliveryProcessing =
  deliveriesFunctions.releaseGitHubDeliveryProcessing
export const bindQueuedGitHubDeliveryToWorkflow =
  deliveriesFunctions.bindQueuedGitHubDeliveryToWorkflow
export const completeQueuedGitHubDelivery =
  deliveriesFunctions.completeQueuedGitHubDelivery
export const terminalizeQueuedGitHubDelivery =
  deliveriesFunctions.terminalizeQueuedGitHubDelivery
export const getTrustLoopWorkflowForDelivery =
  deliveriesFunctions.getTrustLoopWorkflowForDelivery
export const getTrustLoopAcceptanceSnapshot =
  deliveriesFunctions.getTrustLoopAcceptanceSnapshot
export const getDecisionPublicationReplayFixture =
  readModelsFunctions.getDecisionPublicationReplayFixture
export const getDetail = readModelsFunctions.getDetail
export const listRecent = readModelsFunctions.listRecent
