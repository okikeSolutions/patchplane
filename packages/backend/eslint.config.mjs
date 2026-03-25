import js from '@eslint/js'
import convexPlugin from '@convex-dev/eslint-plugin'
import oxlint from 'eslint-plugin-oxlint'
import tseslint from 'typescript-eslint'

const convexFiles = ['convex/**/*.ts']

function withConvexTypeInfo(config) {
  return {
    ...config,
    files: convexFiles,
    languageOptions: {
      ...config.languageOptions,
      parserOptions: {
        ...config.languageOptions?.parserOptions,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  }
}

export default tseslint.config(
  {
    ignores: ['convex/_generated/**'],
  },
  {
    ...js.configs.recommended,
    files: convexFiles,
  },
  ...tseslint.configs.recommendedTypeChecked.map(withConvexTypeInfo),
  ...convexPlugin.configs.recommended.map(withConvexTypeInfo),
  ...oxlint.configs['flat/recommended'],
)
