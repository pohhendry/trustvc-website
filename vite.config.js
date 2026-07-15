import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const isTest = mode === 'test'
  const env = loadEnv(mode, process.cwd(), '')

  const sentryAuthToken =
    env.SENTRY_AUTH_TOKEN ?? process.env.SENTRY_AUTH_TOKEN
  const sentryOrg = env.SENTRY_ORG ?? process.env.SENTRY_ORG
  const sentryProject = env.SENTRY_PROJECT ?? process.env.SENTRY_PROJECT
  const sentryRelease =
    env.VITE_SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE

  const sentryBuildVars = {
    SENTRY_AUTH_TOKEN: sentryAuthToken,
    SENTRY_ORG: sentryOrg,
    SENTRY_PROJECT: sentryProject,
    VITE_SENTRY_RELEASE: sentryRelease,
  }
  const sentryBuildValues = Object.values(sentryBuildVars)
  const allSentryBuildVarsEmpty = sentryBuildValues.every(
    value => value === undefined || value === ''
  )
  const allSentryBuildVarsSet = sentryBuildValues.every(
    value => value !== undefined && value !== ''
  )

  if (!isTest && !allSentryBuildVarsEmpty && !allSentryBuildVarsSet) {
    const missing = Object.entries(sentryBuildVars)
      .filter(([, value]) => value === undefined || value === '')
      .map(([key]) => key)
    throw new Error(
      `Incomplete Sentry build configuration. Set all of SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT, and VITE_SENTRY_RELEASE, or leave them all empty to skip source map upload. Missing: ${missing.join(', ')}`
    )
  }

  const enableSentrySourceMaps = !isTest && allSentryBuildVarsSet

  return {
    define: {
      'process.env': {
        INFURA_API_KEY:
          env.INFURA_API_KEY || process.env.INFURA_API_KEY,
      },
      'process.browser': true,
      ...(isTest ? {} : { 'process.version': JSON.stringify('v16.0.0') })
    },
    build: {
      sourcemap: enableSentrySourceMaps ? 'hidden' : false,
      commonjsOptions: {
        // crypto-browserify → randomfill uses `exports.*`; without this,
        // some CJS can leak into ESM chunks and throw "exports is not defined".
        transformMixedEsModules: true,
      },
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (
              id.includes('/node_modules/ethers/') ||
              id.includes('/node_modules/@tradetrust-tt/') ||
              id.includes('/node_modules/@trustvc/')
            ) return 'vendor-web3'
            if (
              id.includes('/node_modules/react/') ||
              id.includes('/node_modules/react-dom/') ||
              id.includes('/node_modules/react-router')
            ) return 'vendor-react'
          },
        },
      },
    },
    plugins: [
      react(),
      nodePolyfills({
        globals: { Buffer: true, global: true, process: true },
        protocolImports: true,
      }),
      ...(enableSentrySourceMaps
        ? [
            sentryVitePlugin({
              org: sentryOrg,
              project: sentryProject,
              authToken: sentryAuthToken,
              release: { name: sentryRelease },
              sourcemaps: {
                filesToDeleteAfterUpload: ['./dist/**/*.map'],
              },
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {

        'dotenv/config': path.resolve(__dirname, 'src/shims/dotenv-config.js'),
        'node-fetch': path.resolve(__dirname, 'src/shims/node-fetch.js'),
        // Pure ESM shim — avoids CJS `exports` in the browser bundle (crypto-browserify).
        randomfill: path.resolve(__dirname, 'src/shims/randomfill-esm.js'),
        'randomfill/browser': path.resolve(__dirname, 'src/shims/randomfill-esm.js'),
        'randombytes/browser': path.resolve(__dirname, 'src/shims/randombytes-esm.js'),
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/setupTests.ts',
      css: true,
      // verifiablePdf.test.ts drives the real pdfjs worker and needs extra deps
      // inlining + fixtures wiring; it runs under its own vitest.pdf.config.ts.
      exclude: [
        '**/node_modules/**',
        '**/e2e/**',
        '**/verifiablePdf.test.ts',
      ],
    }
  }
})
