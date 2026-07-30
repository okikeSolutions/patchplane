import { publicationFixtureFunctions } from './readModels/publicationFixture'
import { workflowDetailFunctions } from './readModels/workflowDetail'
import { recentWorkflowFunctions } from './readModels/recentWorkflows'

export const readModelsFunctions = {
  ...publicationFixtureFunctions,
  ...workflowDetailFunctions,
  ...recentWorkflowFunctions,
}
