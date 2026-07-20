import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'

import { EXPEDITION_INITIAL_STATE, reduce_expedition } from '../roster/store_reducer'

const auth_source = readFileSync(new URL('../auth/index.ts', import.meta.url), 'utf8')
const reset_source = readFileSync(new URL('./wallet_session_reset.js', import.meta.url), 'utf8')
const expedition_source = readFileSync(new URL('../roster/store.ts', import.meta.url), 'utf8')
const reducer_source = readFileSync(new URL('../roster/store_reducer.ts', import.meta.url), 'utf8')

describe('wallet session reset one-pipeline door', () => {
  test('the async auth edge dispatches a typed input that the expedition reducer folds', () => {
    expect(auth_source).toContain("reset_wallet_session({ type: 'wallet_session/reset' })")
    expect(reset_source).toContain("use_expedition.getState().input({ type: 'wallet_session/reset' })")
    expect(reset_source).not.toContain('use_expedition.setState(')
    expect(reducer_source).toContain('export type ExpeditionInput')
    expect(expedition_source).toContain('reduce_expedition(state, message)')
  })

  test('the pure fold resets every wallet-scoped field and a duplicate input is identity', () => {
    const active_state = {
      loading: true,
      no_character: true,
      character: { id: '0xcharacter' },
      kiosk_id: '0xkiosk',
      personal_kiosk_cap_id: '0xcap',
      busy: true,
      expedition_id: '0xexpedition',
      expedition: { status: 0 },
    }
    const input = { type: 'wallet_session/reset' }

    const reset_state = reduce_expedition(active_state, input)

    expect(reset_state).toEqual(EXPEDITION_INITIAL_STATE)
    expect(active_state.character).toEqual({ id: '0xcharacter' })
    expect(reduce_expedition(reset_state, input)).toBe(reset_state)
  })
})
