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
