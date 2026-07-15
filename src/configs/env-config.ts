// Environment configuration - no imports to avoid circular dependencies.
// Vite exposes VITE_* variables through import.meta.env in browser code.
const networkType = String(
  import.meta.env?.VITE_NETWORK_TYPE || ''
).toLowerCase()

export const IS_TESTNET = networkType === 'testnet'
export const INFURA_API_KEY = process.env.INFURA_API_KEY
export const NETWORK_NAME = IS_TESTNET ? 'sepolia' : 'mainnet'
export const MAGIC_API_KEY =
  (import.meta.env?.VITE_MAGIC_API_KEY as string | undefined) || ''
export const IS_MINIMAL_VERIFIER =
  String(import.meta.env?.VITE_MINIMAL_VERIFIER || '').toLowerCase() === 'true'
