import { WorkflowConsole } from './workflow-console'

export function LoadingWorkflowConsole() {
  return (
    <WorkflowConsole
      metrics={{
        appRequests: 0,
        externalRequests: 0,
        visibleRequests: 0,
      }}
      viewer={undefined}
      workflows={undefined}
    />
  )
}
