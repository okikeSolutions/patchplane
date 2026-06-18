export interface ViewerIdentity {
  subject: string
  name: string
  email?: string
}

export interface PromptRequestRow {
  id: string
  workspaceId: string
  actorId: string
  traceId: string
  source: 'dev' | 'app' | 'external'
  prompt: string
  status: 'created'
  createdAt: number
}
