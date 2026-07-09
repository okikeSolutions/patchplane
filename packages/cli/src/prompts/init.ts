import { Effect } from 'effect'
import { Prompt } from 'effect/unstable/cli'
import { pluginIdsForInitProfile, type InitProfile } from '../services/config-file'

export interface InitPromptAnswers {
  readonly profile: InitProfile
  readonly withPi: boolean
  readonly confirmed: boolean
}

export function promptForInitOptions(defaults: {
  readonly profile?: InitProfile | undefined
  readonly withPi?: boolean | undefined
}) {
  const profileChoices = [
    { title: 'App only', value: 'app' as const },
    { title: 'GitHub webhook sandbox', value: 'githubWebhook' as const },
    { title: 'Full local alpha', value: 'full' as const },
  ].map((choice) => ({
    ...choice,
    description: pluginIdsForInitProfile(choice.value).join(', '),
  }))

  return Effect.gen(function* () {
    const profile = defaults.profile ?? (yield* Prompt.run(Prompt.select({
      message: 'What do you want to set up?',
      choices: profileChoices,
    })))

    const withPi = profile === 'app'
      ? false
      : defaults.withPi ?? (yield* Prompt.run(Prompt.confirm({
        message: 'Enable Daytona Pi execution?',
        initial: false,
      })))

    const confirmed = yield* Prompt.run(Prompt.confirm({
      message: 'Write patchplane.config.json, update .env.local, and create .patchplane state directories?',
      initial: true,
    }))

    return { profile, withPi, confirmed } satisfies InitPromptAnswers
  })
}
