import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

export default [
  { ignores: ['dist', 'coverage', 'scripts/**/*', 'trustvc-cms', '.cache-synpress', 'e2e', 'playwright-report', 'test-results', 'hardhat.config.js', 'vitest.pdf.config.ts'] },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
        projectService: {
          allowDefaultProject: [
            'eslint.config.js',
            'postcss.config.js',
            'tailwind.config.js',
            'vite.config.js',
            'src/test/setup.js',
            'src/shims/dotenv-config.js',
            'src/shims/node-fetch.js',
            'src/shims/randomfill-esm.js',
            'src/shims/randombytes-esm.js',
          ],
        },
      },
    },
    settings: { react: { version: '18.3' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...prettier.rules,
      ...tseslint.configs.recommendedTypeChecked[0].rules,
      'react/jsx-no-target-blank': 'off',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-unused-vars': 'off',
    },
  },
  {
    files: [
      'src/components/common/contexts/OverlayContext.tsx',
      'src/components/common/contexts/providerContext.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
]
