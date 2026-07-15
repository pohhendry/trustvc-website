# Minimal Verifier Dev Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `trustvc-verifier` Render deployment show only the document verification feature, with branding that is unmistakably different from `trustvc.io` / `dev.trustvc.io`, without touching those other deployments' behavior.

**Architecture:** A single new build-time flag, `VITE_MINIMAL_VERIFIER`, read via `import.meta.env` and exported as `IS_MINIMAL_VERIFIER` from `src/configs/env-config.ts`. `App.tsx` checks the flag after all its hooks run and, if true, returns a new `MinimalVerifierApp` component instead of `Navbar` + `AppRouter` + `GoogleTagManager`. Because `AppRouter` never mounts in that branch, no other route is reachable. `MinimalVerifierApp` reuses the existing `VerifySection` component (already provider-wrapped by `main.tsx`), adding a `showDemoCta` prop to `VerifySection` so the outbound "Try our demo document!" CTA can be hidden without affecting the main site, where it stays on by default. The flag is set only in `render.yaml`'s `envVars` for the `trustvc-verifier` service.

**Tech Stack:** React 19 + TypeScript, Vite, Tailwind CSS, Vitest + Testing Library (existing project stack — no new dependencies).

## Global Constraints

- Flag name: `VITE_MINIMAL_VERIFIER`, truthy value is the exact string `'true'` (case-insensitive).
- `trustvc.io` and `dev.trustvc.io` build/deploy configs must not set this flag and must be otherwise untouched.
- Page title in minimal mode: exactly `Doc Verifier · Dev Build`.
- Banner copy: exactly `⚠ Development Build — internal testing only. Not affiliated with trustvc.io.`
- Color scheme in minimal mode: dark slate background (Tailwind `slate-900`/`slate-700`) with amber accents (Tailwind `amber-400`/`amber-500`) — no TrustVC purple/sky (`primary`/`secondary` Tailwind tokens) and no Gilroy font.
- `VerifySection`'s new `showDemoCta` prop must default to `true` so the Home page (`src/pages/Home/index.tsx`, which calls `<VerifySection isDarkMode={isDarkMode} />` with no `showDemoCta`) is unaffected.
- No changes to Sentry/GTM/GA4 wiring — `render.yaml` already omits those vars for this service.
- No new npm dependencies.

---

### Task 1: Add the `IS_MINIMAL_VERIFIER` flag to env-config

**Files:**
- Modify: `src/configs/env-config.ts`
- Test: `src/configs/env-config.test.ts` (create)

**Interfaces:**
- Produces: `IS_MINIMAL_VERIFIER: boolean`, exported from `src/configs/env-config.ts`, read at module-load time from `import.meta.env.VITE_MINIMAL_VERIFIER`.

- [ ] **Step 1: Write the failing test**

Create `src/configs/env-config.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('env-config — IS_MINIMAL_VERIFIER', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('is false when VITE_MINIMAL_VERIFIER is unset', async () => {
    vi.stubEnv('VITE_MINIMAL_VERIFIER', '')
    const { IS_MINIMAL_VERIFIER } = await import('./env-config')
    expect(IS_MINIMAL_VERIFIER).toBe(false)
  })

  it('is true when VITE_MINIMAL_VERIFIER is "true"', async () => {
    vi.stubEnv('VITE_MINIMAL_VERIFIER', 'true')
    const { IS_MINIMAL_VERIFIER } = await import('./env-config')
    expect(IS_MINIMAL_VERIFIER).toBe(true)
  })

  it('is case-insensitive', async () => {
    vi.stubEnv('VITE_MINIMAL_VERIFIER', 'TRUE')
    const { IS_MINIMAL_VERIFIER } = await import('./env-config')
    expect(IS_MINIMAL_VERIFIER).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/configs/env-config.test.ts`
Expected: FAIL — `IS_MINIMAL_VERIFIER` is not exported from `./env-config`.

- [ ] **Step 3: Write minimal implementation**

In `src/configs/env-config.ts`, append after the existing `MAGIC_API_KEY` export:

```ts
export const IS_MINIMAL_VERIFIER =
  String(import.meta.env?.VITE_MINIMAL_VERIFIER || '').toLowerCase() ===
  'true'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/configs/env-config.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/configs/env-config.ts src/configs/env-config.test.ts
git commit -m "feat: add IS_MINIMAL_VERIFIER build flag to env-config"
```

---

### Task 2: Add `showDemoCta` prop to `VerifySection`

**Files:**
- Modify: `src/components/home/VerifySection/VerifySection.tsx:17-19` (props interface), `:34` (component signature), `:218-251` (demo CTA block)
- Test: `src/components/home/VerifySection/VerifySection.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `VerifySectionProps.showDemoCta?: boolean` (default `true`) — Task 3's `MinimalVerifierApp` will pass `showDemoCta={false}`.

- [ ] **Step 1: Write the failing test**

In `src/components/home/VerifySection/VerifySection.test.tsx`, inside the existing `describe('demo section', ...)` block (after the `'opens the document gallery in a new tab when clicked'` test), add:

```tsx
    it('does not render the demo CTA when showDemoCta is false', () => {
      render(<VerifySection isDarkMode={false} showDemoCta={false} />)
      expect(
        screen.queryByText(/Try our demo document!/i)
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText(/Visit Document Gallery/i)
      ).not.toBeInTheDocument()
    })

    it('renders the demo CTA by default when showDemoCta is not passed', () => {
      render(<VerifySection isDarkMode={false} />)
      expect(screen.getByText(/Try our demo document!/i)).toBeInTheDocument()
    })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/home/VerifySection/VerifySection.test.tsx`
Expected: FAIL on the first new test (`showDemoCta` is not a recognized prop; TypeScript/JSX will still render since VerifySectionProps doesn't yet have it, but the demo CTA renders unconditionally today, so `queryByText` finds it and the `not.toBeInTheDocument()` assertion fails).

- [ ] **Step 3: Write minimal implementation**

In `src/components/home/VerifySection/VerifySection.tsx`, change the props interface (currently lines 17-19):

```tsx
interface VerifySectionProps {
  isDarkMode: boolean
  showDemoCta?: boolean
}
```

Change the component signature (currently line 34):

```tsx
const VerifySection: React.FC<VerifySectionProps> = ({
  isDarkMode,
  showDemoCta = true,
}) => {
```

Wrap the existing demo CTA block (currently lines 218-251, the `<div className="demo-button">...</div>`) in a conditional:

```tsx
              {showDemoCta && (
                <div className="demo-button">
                  <div className="demo-content">
                    <div className="demo-text-wrapper">
                      <div className="demo-heading">
                        Try our demo document!
                      </div>
                    </div>
                    <div className="demo-description-wrapper">
                      <div className="demo-description">
                        Experience the interoperability of our documents from
                        the documents gallery!
                      </div>
                    </div>
                  </div>
                  <div className="cta-button-wrapper">
                    <button
                      type="button"
                      className="cta-button"
                      onClick={() =>
                        window.open(
                          'https://gallery.tradetrust.io',
                          '_blank',
                          'noopener,noreferrer'
                        )
                      }
                    >
                      <div className="cta-boundary">
                        <div className="cta-padding" />
                        <div className="cta-text-frame">
                          <div className="cta-label">
                            Visit Document Gallery
                          </div>
                        </div>
                        <div className="cta-padding" />
                      </div>
                    </button>
                  </div>
                </div>
              )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/home/VerifySection/VerifySection.test.tsx`
Expected: PASS (all tests in the file, including the 2 new ones)

- [ ] **Step 5: Commit**

```bash
git add src/components/home/VerifySection/VerifySection.tsx src/components/home/VerifySection/VerifySection.test.tsx
git commit -m "feat: add showDemoCta prop to VerifySection"
```

---

### Task 3: Create `MinimalVerifierApp`

**Files:**
- Create: `src/components/minimal-verifier/MinimalVerifierApp.tsx`
- Create: `src/components/minimal-verifier/index.ts`
- Test: `src/components/minimal-verifier/MinimalVerifierApp.test.tsx` (create)

**Interfaces:**
- Consumes: `VerifySection` from `../home/VerifySection` (props: `isDarkMode: boolean`, `showDemoCta?: boolean`, from Task 2).
- Produces: `MinimalVerifierApp` default export — a zero-prop component. Task 4's `App.tsx` renders `<MinimalVerifierApp />` with no props.

- [ ] **Step 1: Write the failing test**

Create `src/components/minimal-verifier/MinimalVerifierApp.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '../../__tests__/test-utils'
import MinimalVerifierApp from './MinimalVerifierApp'

vi.mock('../home/VerifySection', () => ({
  default: (props: { isDarkMode: boolean; showDemoCta?: boolean }) => (
    <div
      data-testid="verify-section-mock"
      data-is-dark-mode={String(props.isDarkMode)}
      data-show-demo-cta={String(props.showDemoCta)}
    />
  ),
}))

describe('MinimalVerifierApp', () => {
  beforeEach(() => {
    document.title = ''
  })

  afterEach(() => {
    document.head
      .querySelectorAll("link[rel~='icon']")
      .forEach(el => el.remove())
  })

  it('sets the page title on mount', () => {
    render(<MinimalVerifierApp />)
    expect(document.title).toBe('Doc Verifier · Dev Build')
  })

  it('sets a favicon distinct from the default TrustVC favicon', () => {
    render(<MinimalVerifierApp />)
    const link = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
    expect(link).not.toBeNull()
    expect(link?.href).toMatch(/^data:image\/svg\+xml/)
  })

  it('renders the development-only banner', () => {
    render(<MinimalVerifierApp />)
    expect(
      screen.getByText(
        /Development Build — internal testing only\. Not affiliated with trustvc\.io\./i
      )
    ).toBeInTheDocument()
  })

  it('renders the placeholder wordmark, not the TrustVC name alone', () => {
    render(<MinimalVerifierApp />)
    expect(screen.getByText(/Doc Verifier/i)).toBeInTheDocument()
    expect(screen.getByText(/Dev Build/i)).toBeInTheDocument()
  })

  it('renders VerifySection with the demo CTA disabled', () => {
    render(<MinimalVerifierApp />)
    const mock = screen.getByTestId('verify-section-mock')
    expect(mock.dataset.showDemoCta).toBe('false')
    expect(mock.dataset.isDarkMode).toBe('false')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/minimal-verifier/MinimalVerifierApp.test.tsx`
Expected: FAIL — cannot find module `./MinimalVerifierApp`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/minimal-verifier/MinimalVerifierApp.tsx`:

```tsx
import { useEffect } from 'react'
import VerifySection from '../home/VerifySection'

const PAGE_TITLE = 'Doc Verifier · Dev Build'

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#1E293B"/><path d="M12 5.5L19 18H5L12 5.5Z" fill="#F59E0B"/><rect x="11" y="10" width="2" height="5" fill="#1E293B"/><rect x="11" y="16" width="2" height="2" fill="#1E293B"/></svg>`

const setMinimalFavicon = () => {
  const href = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`
  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.type = 'image/svg+xml'
  link.href = href
}

const MinimalVerifierApp = () => {
  useEffect(() => {
    document.title = PAGE_TITLE
    setMinimalFavicon()
  }, [])

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <div
        role="alert"
        className="w-full bg-amber-500 px-4 py-2 text-center text-sm font-bold text-slate-900"
      >
        ⚠ Development Build — internal testing only. Not affiliated with
        trustvc.io.
      </div>
      <header className="flex items-center justify-center border-b border-slate-700 py-6">
        <span className="text-xl font-bold tracking-wide text-amber-400">
          Doc Verifier{' '}
          <span className="font-normal text-slate-400">· Dev Build</span>
        </span>
      </header>
      <main className="flex flex-col items-center p-10">
        <VerifySection isDarkMode={false} showDemoCta={false} />
      </main>
    </div>
  )
}

export default MinimalVerifierApp
```

Create `src/components/minimal-verifier/index.ts`:

```ts
export { default } from './MinimalVerifierApp'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/minimal-verifier/MinimalVerifierApp.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/minimal-verifier/
git commit -m "feat: add MinimalVerifierApp component"
```

---

### Task 4: Wire `IS_MINIMAL_VERIFIER` into `App.tsx`

**Files:**
- Modify: `src/App.tsx:1-10` (imports), `:41-94` (component body)
- Test: `src/App.minimalVerifier.test.tsx` (create)

**Interfaces:**
- Consumes: `IS_MINIMAL_VERIFIER` from `./configs/env-config` (Task 1), `MinimalVerifierApp` default export from `./components/minimal-verifier` (Task 3).

- [ ] **Step 1: Write the failing test**

Create `src/App.minimalVerifier.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from './__tests__/test-utils'

vi.mock('./components/minimal-verifier', () => ({
  default: () => <div data-testid="minimal-verifier-app-mock" />,
}))

describe('App — VITE_MINIMAL_VERIFIER flag', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MINIMAL_VERIFIER', 'true')
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('renders MinimalVerifierApp instead of Navbar/AppRouter when the flag is set', async () => {
    const { default: App } = await import('./App')
    render(<App />)

    expect(screen.getByTestId('minimal-verifier-app-mock')).toBeInTheDocument()
    expect(screen.queryByText('Partners')).not.toBeInTheDocument()
    expect(screen.queryByText('News & Updates')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/App.minimalVerifier.test.tsx`
Expected: FAIL — `getByTestId('minimal-verifier-app-mock')` not found (App still renders Navbar/AppRouter unconditionally).

- [ ] **Step 3: Write minimal implementation**

In `src/App.tsx`, add to the imports (after the `GoogleTagManager` import on line 5):

```tsx
import { IS_MINIMAL_VERIFIER } from './configs/env-config'
import MinimalVerifierApp from './components/minimal-verifier'
```

In the `App` function body, immediately after the three existing `useEffect` calls and before the `const matchedBackgroundRule = ...` line, add:

```tsx
  if (IS_MINIMAL_VERIFIER) {
    return <MinimalVerifierApp />
  }

```

(This keeps every hook call unconditional — the branch is a plain early return, not a conditional hook.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/App.minimalVerifier.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full existing App test suite to confirm no regression**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS (all pre-existing tests still pass — `IS_MINIMAL_VERIFIER` is false by default since `VITE_MINIMAL_VERIFIER` is unset in the test environment)

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.minimalVerifier.test.tsx
git commit -m "feat: render MinimalVerifierApp when VITE_MINIMAL_VERIFIER is set"
```

---

### Task 5: Set the flag for the `trustvc-verifier` Render service

**Files:**
- Modify: `render.yaml`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `VITE_MINIMAL_VERIFIER` env var, read by `src/configs/env-config.ts` (Task 1).

- [ ] **Step 1: Update render.yaml**

Change `render.yaml` from:

```yaml
services:
  - type: web
    name: trustvc-verifier
    runtime: static
    buildCommand: npm ci --include=dev && npm run build
    staticPublishPath: dist
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
```

to:

```yaml
services:
  - type: web
    name: trustvc-verifier
    runtime: static
    buildCommand: npm ci --include=dev && npm run build
    staticPublishPath: dist
    envVars:
      - key: VITE_MINIMAL_VERIFIER
        value: 'true'
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
```

- [ ] **Step 2: Document the var in .env.example**

In `.env.example`, after the `VITE_MAGIC_API_KEY=` / `VITE_NETWORK_TYPE=mainnet` block, add:

```
# Strips the site down to a bare-minimum, distinctly-branded document
# verifier (no marketing pages, no TrustVC branding). Only ever set this
# for the trustvc-verifier Render dev deployment — leave unset for
# trustvc.io / dev.trustvc.io.
VITE_MINIMAL_VERIFIER=
```

- [ ] **Step 3: Verify the build actually produces the minimal page locally**

Run: `VITE_MINIMAL_VERIFIER=true npm run build && npx serve -s dist -l 4173`

Then in a browser, open `http://localhost:4173` and confirm:
- The tab title reads "Doc Verifier · Dev Build" and the favicon is the amber/slate icon (not the TrustVC logo).
- The amber "Development Build" banner is visible at the top.
- No nav links to About/Partners/News/Settings/Contact are present.
- Navigating directly to `http://localhost:4173/partners` (or any other path) still renders the same minimal verifier view, not the marketing Partners page.
- The file-drop verification flow works (drag/drop or browse a `.tt`/`.oa`/`.json` test document).

Stop the `serve` process once confirmed (Ctrl+C).

- [ ] **Step 4: Verify the default build (no flag) is unaffected**

Run: `npm run build && npx serve -s dist -l 4173`

Confirm `http://localhost:4173` still shows the full TrustVC marketing site with Navbar, Hero, and all routes working as before. Stop `serve` (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add render.yaml .env.example
git commit -m "chore: enable minimal verifier mode for the trustvc-verifier Render deploy"
```

---

## Final Verification

- [ ] Run the full test suite: `npm run test`
  Expected: PASS, no failing or newly-skipped tests.
- [ ] Run lint: `npm run lint`
  Expected: no errors.
- [ ] Push the branch (`feature/render-static-deploy`) and let Render redeploy `trustvc-verifier`, then visit `https://trustvc-verifier.onrender.com/` and repeat the checks from Task 5 Step 3 against the live deployment.
