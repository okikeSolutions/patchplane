// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import type { WorkflowDetail } from './types'
import {
  WorkflowRequestMarkdown,
  workflowRequestMarkdown,
} from './workflow-request-markdown'

afterEach(cleanup)

describe('WorkflowRequestMarkdown', () => {
  test('renders GitHub-flavored Markdown as semantic content', () => {
    const { container } = render(
      <WorkflowRequestMarkdown
        markdown={[
          '## Summary',
          '',
          '- [x] Typecheck',
          '- [ ] Browser acceptance',
          '',
          '| File | Purpose |',
          '| --- | --- |',
          '| `src/app.ts` | Entry point |',
          '',
          '> Evidence before trust.',
          '',
          '[PatchPlane](https://patchplane.dev)',
        ].join('\n')}
      />,
    )

    expect(
      screen.getByRole('heading', { level: 2, name: 'Summary' }),
    ).toBeTruthy()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByText('Evidence before trust.')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'PatchPlane' }).getAttribute('href'),
    ).toBe('https://patchplane.dev')
    expect(
      container.querySelector('[data-slot="workflow-request-markdown"]'),
    ).toBeTruthy()
  })

  test('skips raw HTML, executable URLs, and remote images', () => {
    const { container } = render(
      <WorkflowRequestMarkdown
        markdown={[
          '<script>window.compromised = true</script>',
          '<iframe src="https://example.com"></iframe>',
          '[unsafe](javascript:alert(document.domain))',
          '![tracking pixel](https://example.com/pixel.png)',
        ].join('\n\n')}
      />,
    )

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('unsafe').closest('a')).toBeNull()
    expect(screen.queryByText('tracking pixel')).toBeNull()
    expect(container.innerHTML).not.toContain('window.compromised')
  })
})

describe('workflowRequestMarkdown', () => {
  const detail = {
    promptRequest: {
      prompt: 'Fix the title\n\nLegacy **body**',
      externalRef: {
        provider: 'github',
        issueTitle: 'Fix the title',
      },
    },
  } as WorkflowDetail

  test('prefers the separately stored GitHub body', () => {
    expect(
      workflowRequestMarkdown({
        ...detail,
        promptRequest: {
          ...detail.promptRequest,
          externalRef: {
            ...detail.promptRequest.externalRef!,
            issueBody: '## Stored body',
          },
        },
      }),
    ).toBe('## Stored body')
  })

  test('extracts the body from legacy title-plus-body prompts', () => {
    expect(workflowRequestMarkdown(detail)).toBe('Legacy **body**')
  })

  test('extracts the body from legacy pull requests without a stored title', () => {
    expect(
      workflowRequestMarkdown({
        ...detail,
        promptRequest: {
          ...detail.promptRequest,
          externalRef: {
            provider: 'github',
            deliveryId: 'delivery-legacy-pr',
            eventKind: 'github.pull_request.opened',
          },
        },
      }),
    ).toBe('Legacy **body**')
  })
})
