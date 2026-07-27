import { Fragment, type ComponentProps } from 'react'
import { Markdown, RuleType, type MarkdownToJSX } from 'markdown-to-jsx/react'
import type { WorkflowDetail } from './types'

function SafeMarkdownLink({ href, children, ...props }: ComponentProps<'a'>) {
  if (href === undefined || href.length === 0) {
    return <Fragment>{children}</Fragment>
  }

  return (
    <a {...props} href={href} rel="noopener noreferrer">
      {children}
    </a>
  )
}

const markdownOptions = {
  wrapper: Fragment,
  overrides: {
    a: SafeMarkdownLink,
    img: () => null,
  },
  renderRule(next, node) {
    if (
      node.type === RuleType.htmlBlock ||
      node.type === RuleType.htmlComment ||
      node.type === RuleType.htmlSelfClosing ||
      node.type === RuleType.image
    ) {
      return null
    }

    return next()
  },
} satisfies MarkdownToJSX.Options

export function workflowRequestMarkdown(detail: WorkflowDetail) {
  const externalRef = detail.promptRequest.externalRef
  if (externalRef?.issueBody !== undefined) {
    return externalRef.issueBody.trim()
  }

  const prompt = detail.promptRequest.prompt.trim()
  if (externalRef?.provider === 'github') {
    const storedTitle = externalRef.issueTitle?.trim()
    const isLegacyPullRequest = externalRef.eventKind?.startsWith(
      'github.pull_request.',
    ) === true
    const title =
      storedTitle !== undefined && storedTitle.length > 0
        ? storedTitle
        : isLegacyPullRequest
          ? prompt.split(/\r?\n/, 1)[0]?.trim()
          : undefined

    if (title !== undefined && title.length > 0 && prompt.startsWith(title)) {
      return prompt.slice(title.length).trim()
    }
  }

  return prompt
}

export function WorkflowRequestMarkdown({
  markdown,
}: {
  readonly markdown: string
}) {
  return (
    <div
      data-slot="workflow-request-markdown"
      className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-a:break-words prose-a:text-foreground prose-blockquote:text-muted-foreground prose-code:break-words prose-code:text-foreground prose-li:my-1 prose-pre:max-w-full prose-pre:overflow-x-auto prose-table:table-fixed prose-table:w-full prose-td:[overflow-wrap:anywhere] prose-th:[overflow-wrap:anywhere] dark:prose-invert"
    >
      <Markdown options={markdownOptions}>{markdown}</Markdown>
    </div>
  )
}
