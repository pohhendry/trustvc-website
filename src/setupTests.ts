import { expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers)

// Mock Swiper CSS imports to avoid jsdom parse errors during tests
vi.mock('swiper/css', () => ({}))
vi.mock('swiper/css/pagination', () => ({}))
vi.mock('swiper/css/navigation', () => ({}))

// pdfjs-dist v6 (pulled in transitively by useVerify via the Verifiable-PDF
// carrier module) references bleeding-edge DOM/JS globals at import time that
// jsdom's realm does not provide. Stub them here — before any test module loads
// — so merely importing a pdfjs-dependent module doesn't throw. These are
// test-realm shims only; production runs in a real browser that has them.
;(globalThis as unknown as { DOMMatrix?: unknown }).DOMMatrix ??= class {}
;(globalThis as unknown as { Path2D?: unknown }).Path2D ??= class {}
;(globalThis as unknown as { ImageData?: unknown }).ImageData ??= class {}
{
  const u8 = Uint8Array.prototype as unknown as Record<string, unknown>
  if (typeof u8.toHex !== 'function') {
    u8.toHex = function (this: Uint8Array) {
      return [...this].map(b => b.toString(16).padStart(2, '0')).join('')
    }
  }
  if (typeof u8.toBase64 !== 'function') {
    u8.toBase64 = function (this: Uint8Array) {
      let s = ''
      for (const b of this) s += String.fromCharCode(b)
      return btoa(s)
    }
  }
  const U8 = Uint8Array as unknown as Record<string, unknown>
  if (typeof U8.fromHex !== 'function') {
    U8.fromHex = (hex: string) => {
      const out = new Uint8Array(hex.length / 2)
      for (let i = 0; i < out.length; i++)
        out[i] = parseInt(hex.substr(i * 2, 2), 16)
      return out
    }
  }
  if (typeof U8.fromBase64 !== 'function') {
    U8.fromBase64 = (b64: string) =>
      Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  }
  const P = Promise as unknown as Record<string, unknown>
  if (typeof P.try !== 'function') {
    P.try = (fn: (...a: unknown[]) => unknown, ...args: unknown[]) =>
      new Promise(resolve => resolve(fn(...args)))
  }
}

// Cleanup after each test
afterEach(() => {
  cleanup()
  // Reset localStorage mock to prevent state leakage between tests
  Object.keys(localStorageMock).forEach(key => {
    delete localStorageMock[key]
  })
})

// Mock localStorage
const localStorageMock: Record<string, string> = {}

const storage: Storage = {
  getItem: (key: string): string | null => {
    return key in localStorageMock ? localStorageMock[key] : null
  },
  setItem: (key: string, value: string): void => {
    localStorageMock[key] = value
  },
  removeItem: (key: string): void => {
    delete localStorageMock[key]
  },
  clear: (): void => {
    Object.keys(localStorageMock).forEach(key => {
      delete localStorageMock[key]
    })
  },
  key: (index: number): string | null => {
    const keys = Object.keys(localStorageMock)
    return keys[index] || null
  },
  get length(): number {
    return Object.keys(localStorageMock).length
  },
}

globalThis.localStorage = storage
