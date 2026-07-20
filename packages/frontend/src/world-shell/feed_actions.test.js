import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

// The production action imports the browser wallet graph. Supply only its module-load browser surface; action
// behavior itself is isolated through make_feed_pet's local dependencies below (no process-global module mocks).
const restore_browser_globals = install_browser_globals()

const { make_feed_pet } = await import('./feed_actions.js')

afterAll(restore_browser_globals)

const ADDRESS = '0xaddress'
const CHARACTER = '0xcharacter'
const PET = '0xpet'
const PET_TEMPLATE = '0xpet-template'
const FOOD = '0xfood'
const PET_KIOSK = '0xpet-kiosk'
const PET_CAP = '0xpet-cap'
const RESOLVED_KIOSK = '0xresolved-kiosk'
const RESOLVED_CAP = '0xresolved-cap'

const action_args = {
  character_id: CHARACTER,
  pet_item_id: PET,
  pet_template_id: PET_TEMPLATE,
  food_item_id: FOOD,
}

function action_fixture() {
  const sdk = { id: 'sdk' }
  const tx = { id: 'tx' }
  const receipt = { id: 'receipt' }
  const calls = { load_sdk: 0, resolve_kiosk: [], compose_feed: [], submit_tx: [] }
  const action = make_feed_pet({
    read_address: () => ADDRESS,
    load_sdk: async () => {
      calls.load_sdk += 1
      return sdk
    },
    resolve_kiosk: async (...args) => {
      calls.resolve_kiosk.push(args)
      return { kiosk_id: RESOLVED_KIOSK, personal_kiosk_cap_id: RESOLVED_CAP }
    },
    compose_feed: (args) => {
      calls.compose_feed.push(args)
      return tx
    },
    submit_tx: async (...args) => {
      calls.submit_tx.push(args)
      return receipt
    },
  })
  return { action, calls, sdk, tx, receipt }
}

describe('feed_pet action routing', () => {
  test('a full loose-pet handle bypasses resolution and submits the exact item identities once', async () => {
    const { action, calls, tx, receipt } = action_fixture()

    await expect(action({ ...action_args, kiosk_id: PET_KIOSK, personal_kiosk_cap_id: PET_CAP })).resolves.toBe(receipt)
    expect(calls.load_sdk).toBe(0)
    expect(calls.resolve_kiosk).toEqual([])
    expect(calls.compose_feed).toEqual([
      {
        kiosk_id: PET_KIOSK,
        personal_kiosk_cap_id: PET_CAP,
        ...action_args,
      },
    ])
    expect(calls.submit_tx).toEqual([['feed', tx]])
  })

  test('a partial loose-pet handle is rejected before resolution or submission', async () => {
    const { action, calls } = action_fixture()

    await expect(action({ ...action_args, kiosk_id: PET_KIOSK })).rejects.toThrow(/handle is incomplete/)
    await expect(action({ ...action_args, personal_kiosk_cap_id: PET_CAP })).rejects.toThrow(/handle is incomplete/)
    expect(calls.load_sdk).toBe(0)
    expect(calls.resolve_kiosk).toEqual([])
    expect(calls.compose_feed).toEqual([])
    expect(calls.submit_tx).toEqual([])
  })

  test('an omitted handle resolves the character kiosk before composing and submits once', async () => {
    const { action, calls, sdk, tx, receipt } = action_fixture()

    await expect(action(action_args)).resolves.toBe(receipt)
    expect(calls.load_sdk).toBe(1)
    expect(calls.resolve_kiosk).toEqual([[sdk, ADDRESS, CHARACTER]])
    expect(calls.compose_feed).toEqual([
      {
        kiosk_id: RESOLVED_KIOSK,
        personal_kiosk_cap_id: RESOLVED_CAP,
        ...action_args,
      },
    ])
    expect(calls.submit_tx).toEqual([['feed', tx]])
  })
})
