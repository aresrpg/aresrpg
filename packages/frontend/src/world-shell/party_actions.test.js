import { afterAll, afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import * as social from '@aresrpg/sdk/social'

import { reset_auth_mock, set_auth_mock_implementation } from '../test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'
import { use_toast } from '../toast'
import * as report from '../core/report.js'

import * as kiosk_resolve from './kiosk_resolve.js'

const composed = []
const signed = []

const builder = (name) => () => (args) => {
  composed.push({ name, args })
  return { name, args }
}

const social_spies = [
  spyOn(social, 'create_party_ptb').mockImplementation(builder('create')),
  spyOn(social, 'party_invite_ptb').mockImplementation(builder('invite')),
  spyOn(social, 'party_accept_ptb').mockImplementation(builder('accept')),
  spyOn(social, 'party_invite_accept_own_ptb').mockImplementation(builder('invite_accept_own')),
  spyOn(social, 'party_decline_ptb').mockImplementation(builder('decline')),
  spyOn(social, 'party_kick_ptb').mockImplementation(builder('kick')),
  spyOn(social, 'party_leave_ptb').mockImplementation(builder('leave')),
  spyOn(social, 'party_disband_ptb').mockImplementation(builder('disband')),
]

const reset_party_auth = () => {
  reset_auth_mock({ address: '0xwallet', wallet_name: 'wallet' })
  set_auth_mock_implementation('sign_and_execute_transaction', async (wallet_name, address, tx) => {
    signed.push({ wallet_name, address, tx })
    return { digest: `digest-${signed.length}` }
  })
}

reset_party_auth()

const get_sdk = async () => ({
  grpc_client: {
    core: {
      waitForTransaction: async () => ({
        Transaction: {
          effects: {
            status: { success: true },
            changedObjects: [{ idOperation: 'Created', objectId: '0xcreated-party', outputVersion: '1' }],
          },
          objectTypes: { '0xcreated-party': '0xsocial::party::Party' },
        },
      }),
    },
  },
})
set_expedition_sdk_mock(get_sdk)
const toast_promise = spyOn(use_toast.getState(), 'promise').mockImplementation((promise) => promise)
const kiosk_for_character = spyOn(kiosk_resolve, 'kiosk_for_character').mockImplementation(
  async (_sdk, _address, character_id) => ({
    kiosk_id: `kiosk-${character_id}`,
    personal_kiosk_cap_id: `cap-${character_id}`,
  })
)

const { create_party, invite_to_party, join_owned_alts_to_party, accept_party_invite, decline_party_invite } =
  await import('./party_actions.js')

beforeEach(() => {
  composed.length = 0
  signed.length = 0
  reset_party_auth()
  set_expedition_sdk_mock(get_sdk)
})

afterEach(() => {
  reset_expedition_sdk_mock()
  reset_auth_mock()
})

afterAll(() => {
  for (const social_spy of social_spies) social_spy.mockRestore()
  toast_promise.mockRestore()
  kiosk_for_character.mockRestore()
})

test('create and invite compose exact character IDs with the acting leader proof', async () => {
  expect((await create_party('0xleader')).party_id).toBe('0xcreated-party')
  await invite_to_party('0xparty', '0xleader', '0xinvited', '0xinvited-owner')

  expect(composed).toEqual([
    {
      name: 'create',
      args: {
        kiosk_id: 'kiosk-0xleader',
        personal_kiosk_cap_id: 'cap-0xleader',
        leader_character_id: '0xleader',
      },
    },
    {
      name: 'invite',
      args: {
        party_id: '0xparty',
        leader_kiosk_id: 'kiosk-0xleader',
        leader_personal_kiosk_cap_id: 'cap-0xleader',
        leader_character_id: '0xleader',
        invited_character_id: '0xinvited',
        invited_owner: '0xinvited-owner',
      },
    },
  ])
  expect(signed.map((row) => row.tx.name)).toEqual(['create', 'invite'])
})

test('accept and decline each compose and sign the invited character own proof', async () => {
  await accept_party_invite('0xparty', '0xinvited')
  await decline_party_invite('0xparty', '0xinvited')

  expect(composed).toEqual([
    {
      name: 'accept',
      args: {
        party_id: '0xparty',
        kiosk_id: 'kiosk-0xinvited',
        personal_kiosk_cap_id: 'cap-0xinvited',
        character_id: '0xinvited',
      },
    },
    {
      name: 'decline',
      args: {
        party_id: '0xparty',
        kiosk_id: 'kiosk-0xinvited',
        personal_kiosk_cap_id: 'cap-0xinvited',
        character_id: '0xinvited',
      },
    },
  ])
  expect(signed.map((row) => row.tx.name)).toEqual(['accept', 'decline'])
})

test('owned alts each receive one sequential invite+accept PTB with exact leader and invitee proofs', async () => {
  const receipts = await join_owned_alts_to_party({
    party_id: '0xparty',
    leader_character_id: '0xleader',
    invited_character_ids: ['0xalt-a', '0xalt-b'],
  })

  expect([...receipts.keys()]).toEqual(['0xalt-a', '0xalt-b'])
  expect(composed).toEqual([
    {
      name: 'invite_accept_own',
      args: {
        party_id: '0xparty',
        leader_kiosk_id: 'kiosk-0xleader',
        leader_personal_kiosk_cap_id: 'cap-0xleader',
        invited_kiosk_id: 'kiosk-0xalt-a',
        invited_personal_kiosk_cap_id: 'cap-0xalt-a',
        leader_character_id: '0xleader',
        invited_character_id: '0xalt-a',
        invited_owner: '0xwallet',
      },
    },
    {
      name: 'invite_accept_own',
      args: {
        party_id: '0xparty',
        leader_kiosk_id: 'kiosk-0xleader',
        leader_personal_kiosk_cap_id: 'cap-0xleader',
        invited_kiosk_id: 'kiosk-0xalt-b',
        invited_personal_kiosk_cap_id: 'cap-0xalt-b',
        leader_character_id: '0xleader',
        invited_character_id: '0xalt-b',
        invited_owner: '0xwallet',
      },
    },
  ])
  expect(signed.map((row) => row.tx.name)).toEqual(['invite_accept_own', 'invite_accept_own'])
})

// ── "Auto follow" repro: party.move's invite asserts `!contains_invite(pending, character)` —
// a pending invite for this exact character can already exist (a prior single-invite path, or an earlier
// half-attempt), and the picker has no visibility into `party.pending` to grey it out. Without the self-heal
// below, EVERY retry re-runs invite+accept and dies on the SAME EAlreadyInvited abort, forever. RED before the
// fix: the compose threw the raw refusal straight through with no recovery.
test('EAlreadyInvited on the invite+accept compose self-heals by accepting the existing pending invite', async () => {
  const already_invited = new Error('MoveAbort(MoveLocation { module: Identifier("party") }, 203) in command 0')
  set_auth_mock_implementation('sign_and_execute_transaction', async (wallet_name, address, tx) => {
    signed.push({ wallet_name, address, tx })
    if (tx.name === 'invite_accept_own' && tx.args.invited_character_id === '0xalt-stuck') throw already_invited
    return { digest: `digest-${signed.length}` }
  })

  const receipts = await join_owned_alts_to_party({
    party_id: '0xparty',
    leader_character_id: '0xleader',
    invited_character_ids: ['0xalt-stuck'],
  })

  expect([...receipts.keys()]).toEqual(['0xalt-stuck']) // recovered — not lost, not left stuck
  expect(composed.map((c) => c.name)).toEqual(['invite_accept_own', 'accept']) // the doomed invite, then the self-heal
  expect(composed[1].args).toEqual({
    party_id: '0xparty',
    kiosk_id: 'kiosk-0xalt-stuck',
    personal_kiosk_cap_id: 'cap-0xalt-stuck',
    character_id: '0xalt-stuck',
  })
  expect(signed.map((row) => row.tx.name)).toEqual(['invite_accept_own', 'accept']) // exactly one recovery signature, no loop
})

test('a DIFFERENT party abort (not EAlreadyInvited) never triggers the accept-only recovery — it still refuses honestly', async () => {
  const party_full = new Error('MoveAbort(MoveLocation { module: Identifier("party") }, 204) in command 0') // EPartyFull
  set_auth_mock_implementation('sign_and_execute_transaction', async (wallet_name, address, tx) => {
    signed.push({ wallet_name, address, tx })
    throw party_full
  })

  await expect(
    join_owned_alts_to_party({
      party_id: '0xparty',
      leader_character_id: '0xleader',
      invited_character_ids: ['0xalt-a'],
    })
  ).rejects.toThrow()

  expect(composed.map((c) => c.name)).toEqual(['invite_accept_own']) // no accept recovery attempt for a non-203 abort
})

test('reports a confirmed owned member before a later join refusal so callers never replay it', async () => {
  const confirmed = []
  const refusal = new Error('second join refused')
  set_auth_mock_implementation('sign_and_execute_transaction', async (_wallet_name, _address, tx) => {
    if (tx.args.invited_character_id === '0xalt-b') throw refusal
    return { digest: `digest-${tx.args.invited_character_id}` }
  })

  const joining = join_owned_alts_to_party({
    party_id: '0xparty',
    leader_character_id: '0xleader',
    invited_character_ids: ['0xalt-a', '0xalt-b'],
    on_joined: (character_id) => confirmed.push(character_id),
  })

  await expect(joining).rejects.toBe(refusal)
  expect(confirmed).toEqual(['0xalt-a'])
})

// ── Fix 1: SILENT SYSTEM CREATES — the tx-door + toast-door oracle (money law: count txs, never toast-absence) ──

test('a silent create signs the create tx exactly once but never opens the create toast (system auto-form)', async () => {
  toast_promise.mockClear()
  const { party_id } = await create_party('0xleader', { silent: true })

  expect(party_id).toBe('0xcreated-party')
  expect(signed.map((row) => row.tx.name)).toEqual(['create']) // exactly ONE on-chain create — silencing never skips or doubles it
  expect(toast_promise).not.toHaveBeenCalled() // …and the pending/success toast is suppressed for the system entry
})

test('a visible create (default) drives exactly one create toast for the human click (unchanged)', async () => {
  toast_promise.mockClear()
  await create_party('0xleader')

  expect(signed.map((row) => row.tx.name)).toEqual(['create'])
  expect(toast_promise).toHaveBeenCalledTimes(1) // the explicit-user toast stays EXACTLY as-is
})

test('an executed-failed silent create is signed once, never refired, and its failure still reports (burn-law + telemetry)', async () => {
  // waitForTransaction reports a post-submission on-chain failure: a digest exists = gas already burned. The
  // create must surface the failure honestly and NEVER resubmit (a retry would burn again). Silencing drops the
  // TOAST, not the telemetry: the burned-gas failure still reaches Sentry.
  const report_spy = spyOn(report, 'report_error').mockImplementation(() => {})
  set_expedition_sdk_mock(async () => ({
    grpc_client: { core: { waitForTransaction: async () => ({}) } }, // no `Transaction` key → normalize_receipt → failure
  }))

  let threw = false
  try {
    await create_party('0xleader', { silent: true })
  } catch {
    threw = true
  }

  expect(threw).toBe(true)
  expect(signed.map((row) => row.tx.name)).toEqual(['create']) // ONE submission, no refire
  expect(report_spy).toHaveBeenCalledTimes(1) // silenced toast, but the failure telemetry survives
  report_spy.mockRestore()
})
