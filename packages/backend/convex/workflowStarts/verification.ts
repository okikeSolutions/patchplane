import { verificationPlanFunctions } from './verification/plans'
import { verificationExecutionGroupFunctions } from './verification/executionGroups'
import { verificationResultFunctions } from './verification/results'

export const verificationFunctions = {
  ...verificationPlanFunctions,
  ...verificationExecutionGroupFunctions,
  ...verificationResultFunctions,
}
