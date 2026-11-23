import { Context, type Effect } from 'effect'
import type {
  SandboxCredentialPolicyError,
  VerificationAttemptId,
} from '@patchplane/domain'
import type { ShortLivedAttemptModelCredential } from './sandbox-credential-policy'

export interface ModelCredentialIssuerService {
  readonly issueAttemptCredential: (
    attemptId: VerificationAttemptId,
  ) => Effect.Effect<
    ShortLivedAttemptModelCredential,
    SandboxCredentialPolicyError
  >
}

export class ModelCredentialIssuer extends Context.Service<
  ModelCredentialIssuer,
  ModelCredentialIssuerService
>()('@patchplane/core/ModelCredentialIssuer') {}
