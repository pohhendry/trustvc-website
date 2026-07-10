import { defineConfig, mergeConfig } from 'vitest/config'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import baseConfig from './vite.config.js'

// Read fixtures here (config runs in real Node, before the browser polyfills
// take over the test module graph) and hand them to the test via `provide`.
const fx = (name: string) =>
  readFileSync(
    path.resolve(__dirname, 'src/utils/__fixtures__', name)
  ).toString('base64')

// Test-only config for the Verifiable-PDF carrier tests. The base config's
// vite-plugin-node-polyfills maps `url` onto node-stdlib-browser, whose bare
// `import 'punycode'` cannot be resolved as a directory by vitest's ESM loader
// when pdfjs-dist is loaded. Aliasing punycode to its actual entry file and
// inlining pdfjs fixes resolution WITHOUT touching the shared vite.config.js.
export default defineConfig(configEnv => {
  const base: any =
    typeof baseConfig === 'function' ? baseConfig(configEnv) : baseConfig
  // The base config excludes verifiablePdf.test.ts (it runs only here). Strip
  // that entry before merging so this config can actually collect it — mergeConfig
  // concatenates `exclude` arrays, so we cannot simply re-add it.
  if (base?.test?.exclude) {
    base.test.exclude = base.test.exclude.filter(
      (p: string) => !p.includes('verifiablePdf.test.ts')
    )
  }
  return mergeConfig(base, {
    resolve: {
      alias: {
        punycode: path.resolve(
          __dirname,
          'node_modules/punycode/punycode.js'
        ),
      },
    },
    test: {
      include: ['src/utils/verifiablePdf.test.ts'],
      server: {
        deps: { inline: ['pdfjs-dist', 'node-stdlib-browser'] },
      },
      provide: {
        certificatePdfB64: fx('certificate.pdf'),
        plainPdfB64: fx('certificate-preview.pdf'),
      },
    },
  })
})
