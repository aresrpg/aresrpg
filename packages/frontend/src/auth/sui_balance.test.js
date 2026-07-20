// Proves the wallet-balance invalidation primitives (the stale-display fix): the fetch returns
// fresh MIST and KEEPS last-known on failure (never blanks), and the post-tx trigger fires ONLY after a tx
// executes (gas moved), never on a pre-sign refusal. get_sdk is injected — no process-global module mock.
import { describe, expect, mock, test } from 'bun:test'

import { read_sui_balance_mist, with_post_tx_refresh } from './sui_balance'

const fake_sdk = (balance_mist) => async () => ({
  grpc_client: { core: { getBalance: async () => ({ balance: { balance: String(balance_mist) } }) } },
})
const throwing_sdk = () => async () => ({
  grpc_client: {
    core: {
      getBalance: async () => {
        throw new Error('rpc down')
      },
    },
  },
})

describe('read_sui_balance_mist — the single fetch home', () => {
  test('success → BigInt MIST (a real 0.82 SUI balance)', async () => {
    expect(await read_sui_balance_mist('0xabc', fake_sdk('820000000'))).toBe(820_000_000n)
  })
  test('read failure → null (keep last-known, never blank the display)', async () => {
    expect(await read_sui_balance_mist('0xabc', throwing_sdk())).toBeNull()
  })
})

describe('with_post_tx_refresh — post-tx invalidation trigger', () => {
  test('executor RESOLVES (tx executed → gas moved) → refresh fires once, result passthrough', async () => {
    const refresh = mock(() => {})
    const res = await with_post_tx_refresh(async () => ({ digest: 'OK' }), refresh)
    expect(res).toEqual({ digest: 'OK' })
    expect(refresh).toHaveBeenCalledTimes(1)
  })
  test('executor REJECTS (pre-sign dry-run refusal, no gas) → refresh NEVER fires', async () => {
    const refresh = mock(() => {})
    await expect(
      with_post_tx_refresh(async () => {
        throw new Error('refused before signing')
      }, refresh)
    ).rejects.toThrow('refused before signing')
    expect(refresh).toHaveBeenCalledTimes(0)
  })
})
