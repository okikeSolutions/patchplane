import { Context, Effect, Layer, Option, Path } from 'effect'
import { Flag, GlobalFlag } from 'effect/unstable/cli'

export interface CliGlobalOptionsValue {
  readonly cwd?: string | undefined
  readonly configFile?: string | undefined
  readonly envFiles: readonly string[]
}

export const CliCwdFlag = GlobalFlag.setting('patchplane-cwd')({
  flag: Flag.string('cwd').pipe(
    Flag.withDescription('Run as if PatchPlane was started in this directory'),
    Flag.withMetavar('DIR'),
    Flag.optional,
  ),
})

export const CliConfigFlag = GlobalFlag.setting('patchplane-config')({
  flag: Flag.string('config').pipe(
    Flag.withDescription('Path to patchplane.config.json'),
    Flag.withMetavar('FILE'),
    Flag.optional,
  ),
})

export const CliDotenvFlag = GlobalFlag.setting('patchplane-dotenv')({
  flag: Flag.string('dotenv').pipe(
    Flag.withAlias('env-file'),
    Flag.withDescription('Additional dotenv file to load before running the command'),
    Flag.withMetavar('FILE'),
    Flag.atLeast(0),
  ),
})

function resolveFromProjectRoot(pathService: Path.Path, projectRoot: string | undefined, value: string) {
  return projectRoot === undefined ? pathService.resolve(value) : pathService.resolve(projectRoot, value)
}

export class CliGlobalOptions extends Context.Service<CliGlobalOptions, CliGlobalOptionsValue>()('patchplane/CliGlobalOptions') {
  static readonly empty = Layer.succeed(this, {
    envFiles: [],
  } satisfies CliGlobalOptionsValue)

  static readonly Live = Layer.effect(this, Effect.gen(function* () {
    const path = yield* Path.Path
    const cwd = yield* CliCwdFlag
    const config = yield* CliConfigFlag
    const dotenv = yield* CliDotenvFlag

    const projectRoot = Option.match(cwd, {
      onNone: () => undefined,
      onSome: (value) => path.resolve(value),
    })
    const configFile = Option.match(config, {
      onNone: () => undefined,
      onSome: (value) => resolveFromProjectRoot(path, projectRoot, value),
    })
    const envFiles = dotenv.map((envFile) => resolveFromProjectRoot(path, projectRoot, envFile))

    return {
      cwd: projectRoot,
      configFile,
      envFiles,
    } satisfies CliGlobalOptionsValue
  }))

  static layer(value: CliGlobalOptionsValue) {
    return Layer.succeed(this, value)
  }
}
