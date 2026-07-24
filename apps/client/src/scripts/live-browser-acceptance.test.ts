import { describe, expect, test } from 'vitest'
import {
  assertWorkflowReadback,
  browserProcessEnvironment,
  isWorkflowReadbackConfirmation,
  parseLiveBrowserAcceptanceOptions,
} from './live-browser-acceptance'

describe('live browser acceptance options', () => {
  test('fails closed unless the opt-in flag is exactly true', () => {
    expect(
      parseLiveBrowserAcceptanceOptions([], {
        PATCHPLANE_LIVE_BROWSER_TEST: 'TRUE',
        PATCHPLANE_PUBLIC_APP_URL: 'https://app.example.test',
      }),
    ).toEqual({ enabled: false })
  })

  test('accepts a public HTTPS base URL after opt-in', () => {
    const options = parseLiveBrowserAcceptanceOptions([], {
      PATCHPLANE_LIVE_BROWSER_TEST: 'true',
      PATCHPLANE_PUBLIC_APP_URL: 'https://app.example.test/',
    })

    expect(options.enabled).toBe(true)
    expect(options.baseUrl?.toString()).toBe('https://app.example.test/')
  })

  test.each([
    'https://user:password@app.example.test',
    'https://app.example.test/?token=value',
    'https://app.example.test/#credential',
    'http://app.example.test',
    'file:///tmp/patchplane',
  ])('rejects credential-bearing or non-web base URL %s', (baseUrl) => {
    expect(() =>
      parseLiveBrowserAcceptanceOptions([], {
        PATCHPLANE_LIVE_BROWSER_TEST: 'true',
        PATCHPLANE_PUBLIC_APP_URL: baseUrl,
      }),
    ).toThrow()
  })

  test('allows HTTP only for loopback development', () => {
    const options = parseLiveBrowserAcceptanceOptions([], {
      PATCHPLANE_LIVE_BROWSER_TEST: 'true',
      PATCHPLANE_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
    })

    expect(options.baseUrl?.origin).toBe('http://127.0.0.1:3000')
  })

  test('accepts a workflow ID and expected decision from environment or CLI', () => {
    const fromEnvironment = parseLiveBrowserAcceptanceOptions([], {
      PATCHPLANE_LIVE_BROWSER_TEST: 'true',
      PATCHPLANE_PUBLIC_APP_URL: 'https://app.example.test',
      PATCHPLANE_SMOKE_WORKFLOW_RUN_ID: 'workflow_ABC-123',
      PATCHPLANE_SMOKE_EXPECTED_DECISION: 'approved',
    })
    const fromCli = parseLiveBrowserAcceptanceOptions(
      [
        '--workflow-run-id=workflow-456',
        '--expected-decision=changes-requested',
      ],
      {
        PATCHPLANE_LIVE_BROWSER_TEST: 'true',
        PATCHPLANE_PUBLIC_APP_URL: 'https://app.example.test',
      },
    )

    expect(fromEnvironment).toMatchObject({
      workflowRunId: 'workflow_ABC-123',
      expectedDecision: 'approved',
    })
    expect(fromCli).toMatchObject({
      workflowRunId: 'workflow-456',
      expectedDecision: 'changes-requested',
    })
  })

  test('requires a supported expected decision exactly when workflow readback is configured', () => {
    expect(() =>
      parseLiveBrowserAcceptanceOptions([], {
        PATCHPLANE_LIVE_BROWSER_TEST: 'true',
        PATCHPLANE_PUBLIC_APP_URL: 'https://app.example.test',
        PATCHPLANE_SMOKE_WORKFLOW_RUN_ID: 'workflow-123',
      }),
    ).toThrow('--expected-decision')

    expect(() =>
      parseLiveBrowserAcceptanceOptions([], {
        PATCHPLANE_LIVE_BROWSER_TEST: 'true',
        PATCHPLANE_PUBLIC_APP_URL: 'https://app.example.test',
        PATCHPLANE_SMOKE_WORKFLOW_RUN_ID: 'workflow-123',
        PATCHPLANE_SMOKE_EXPECTED_DECISION: 'pending',
      }),
    ).toThrow('--expected-decision')

    expect(() =>
      parseLiveBrowserAcceptanceOptions(['--expected-decision=rejected'], {
        PATCHPLANE_LIVE_BROWSER_TEST: 'true',
        PATCHPLANE_PUBLIC_APP_URL: 'https://app.example.test',
      }),
    ).toThrow('Expected decision requires a workflow run ID')
  })

  test.each([
    '../workflow',
    'workflow/child',
    'workflow%2Fchild',
    'workflow?token=value',
    '-workflow',
    `${'a'.repeat(128)}b`,
  ])('rejects URL-injecting workflow ID %s', (workflowRunId) => {
    expect(() =>
      parseLiveBrowserAcceptanceOptions([], {
        PATCHPLANE_LIVE_BROWSER_TEST: 'true',
        PATCHPLANE_PUBLIC_APP_URL: 'https://app.example.test',
        PATCHPLANE_SMOKE_WORKFLOW_RUN_ID: workflowRunId,
        PATCHPLANE_SMOKE_EXPECTED_DECISION: 'approved',
      }),
    ).toThrow('Workflow run ID has an invalid shape')
  })

  test('requires an explicit workflow readback confirmation', () => {
    expect(isWorkflowReadbackConfirmation('confirm')).toBe(true)
    expect(isWorkflowReadbackConfirmation('  confirm  ')).toBe(true)
    expect(isWorkflowReadbackConfirmation('')).toBe(false)
    expect(isWorkflowReadbackConfirmation('yes')).toBe(false)
    expect(isWorkflowReadbackConfirmation('CONFIRM')).toBe(false)
  })

  test('passes only non-secret process settings to the browser process', () => {
    expect(
      browserProcessEnvironment({
        HOME: '/tmp/profile-owner',
        PATH: '/usr/bin',
        GITHUB_PRIVATE_KEY: 'private-key',
        PATCHPLANE_SYSTEM_INGESTION_SECRET: 'system-secret',
      }),
    ).toEqual({ HOME: '/tmp/profile-owner', PATH: '/usr/bin' })
  })

  test('rejects unsupported arguments without reflecting their value', () => {
    expect(() =>
      parseLiveBrowserAcceptanceOptions(['--token=sensitive-value'], {
        PATCHPLANE_LIVE_BROWSER_TEST: 'true',
      }),
    ).toThrow('Unsupported argument')

    try {
      parseLiveBrowserAcceptanceOptions(['--token=sensitive-value'], {
        PATCHPLANE_LIVE_BROWSER_TEST: 'true',
      })
    } catch (cause) {
      expect(String(cause)).not.toContain('sensitive-value')
    }
  })
})

describe('workflow readback assertion', () => {
  const validReadback = {
    workflowRun: { id: 'workflow-123' },
    humanDecisions: [
      {
        id: 'decision-old',
        status: 'rejected',
        decidedAt: 100,
      },
      {
        id: 'decision-latest',
        status: 'approved',
        decidedAt: 200,
      },
    ],
    publicationResults: [
      {
        status: 'published',
        externalId: 'check-456',
        idempotencyKey: 'decision-latest:check-run',
      },
      {
        status: 'published',
        externalId: 'comment-789',
        idempotencyKey: 'decision-latest:issue-comment',
      },
      {
        status: 'failed',
        idempotencyKey: 'decision-old:check-run',
      },
    ],
  }

  test('parses normalized JSON and summarizes the latest correlated durable state', () => {
    expect(
      assertWorkflowReadback(
        JSON.stringify(validReadback),
        'workflow-123',
        'approved',
      ),
    ).toEqual({
      workflowRunId: 'workflow-123',
      decisionStatus: 'approved',
      humanDecisionCount: 2,
      publishedPublicationResultCount: 2,
    })
  })

  test('rejects malformed JSON without reflecting its contents', () => {
    expect(() =>
      assertWorkflowReadback(
        '{"workflowRun":"private-value"',
        'workflow-123',
        'approved',
      ),
    ).toThrow('Raw workflow readback is not valid JSON')

    try {
      assertWorkflowReadback(
        '{"workflowRun":"private-value"',
        'workflow-123',
        'approved',
      )
    } catch (cause) {
      expect(String(cause)).not.toContain('private-value')
    }
  })

  test('rejects a mismatched workflow or latest decision status', () => {
    expect(() =>
      assertWorkflowReadback(
        JSON.stringify(validReadback),
        'workflow-other',
        'approved',
      ),
    ).toThrow('unexpected workflow run ID')
    expect(() =>
      assertWorkflowReadback(
        JSON.stringify(validReadback),
        'workflow-123',
        'rejected',
      ),
    ).toThrow('Latest human decision does not match expected status')
  })

  test.each([
    {
      name: 'missing correlation',
      publicationResults: [
        {
          status: 'published',
          externalId: 'check-old',
          idempotencyKey: 'decision-old:check-run',
        },
      ],
      error: 'no correlated publication results',
    },
    {
      name: 'failed publication',
      publicationResults: [
        {
          status: 'failed',
          externalId: 'check-456',
          idempotencyKey: 'decision-latest:check-run',
        },
      ],
      error: 'not durably published',
    },
    {
      name: 'missing external ID',
      publicationResults: [
        {
          status: 'published',
          externalId: '   ',
          idempotencyKey: 'decision-latest:check-run',
        },
      ],
      error: 'not durably published',
    },
  ])('rejects $name', ({ publicationResults, error }) => {
    expect(() =>
      assertWorkflowReadback(
        JSON.stringify({ ...validReadback, publicationResults }),
        'workflow-123',
        'approved',
      ),
    ).toThrow(error)
  })
})
