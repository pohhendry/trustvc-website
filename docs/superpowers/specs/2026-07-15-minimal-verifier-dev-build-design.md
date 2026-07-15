# Minimal Verifier Dev Build — Design

## Problem

`render.yaml` deploys this repo's full marketing site (Home, News, Partners, About,
Settings, Contact) to Render under the service name `trustvc-verifier`, live at
`trustvc-verifier.onrender.com`. It ships with full TrustVC branding, identical to
`trustvc.io`. This is only meant to be a throwaway dev instance for exercising the
document verification feature, so it should be stripped to the bare minimum and made
visibly distinct from `trustvc.io` / `dev.trustvc.io` so nobody mistakes it for a
real environment.

## Approach

Add a build-time flag, `VITE_MINIMAL_VERIFIER=true`, set only in `render.yaml`'s
`envVars` for the `trustvc-verifier` service. `trustvc.io` and `dev.trustvc.io` builds
never set this var, so they are unaffected.

In `src/App.tsx`, when the flag is set, the app renders a new `MinimalVerifierApp`
component instead of `Navbar` + `AppRouter` + `GoogleTagManager`. Because `AppRouter`
never mounts, no other route (News, Partners, About, Settings, Contact) is reachable
on this deployment even by typing the URL directly — there is effectively only one
view.

## `MinimalVerifierApp`

- Renders inside the existing provider tree from `main.tsx` (Document/Provider/
  TokenInformation/Overlay contexts), so `VerifySection` works unmodified.
- On mount, sets `document.title` to `Doc Verifier · Dev Build` and swaps the
  `<link rel="icon">` href to a distinct amber/slate favicon (data URI, no new
  binary asset needed), so even the browser tab differs from trustvc.io.
- Layout, top to bottom:
  1. A persistent banner: "⚠ Development Build — internal testing only. Not
     affiliated with trustvc.io."
  2. A plain-text wordmark header, "Doc Verifier · Dev Build" — no TrustVC logo,
     no Gilroy font.
  3. `<VerifySection isDarkMode={false} showDemoCta={false} />`.
  4. No footer, no nav, no links to the marketing site.
- Color scheme: dark slate background (`#1E293B`-ish) with amber accents
  (`#F59E0B`-ish) — the opposite of TrustVC's purple/sky palette, deliberately
  reading as a "caution / non-production" theme.

## `VerifySection` change

Add an optional `showDemoCta` prop (default `true`, so the Home page's existing
"Try our demo document!" CTA to gallery.tradetrust.io is unaffected). When `false`,
that block is not rendered. This is the only change to shared/production code, and
it's additive and backward compatible.

## Out of scope

- Not touching Sentry/GTM/GA4 env vars — `render.yaml` already omits them for this
  service, so they stay disabled.
- Not modifying `trustvc.io` / `dev.trustvc.io` deploy configs or behavior.
- Not restructuring the build (no new Vite entry point / multi-page build).
