// GAS-COIN PIN — THE ROUND-TRIP PROOF (<1s lane). The commit-latency blocker is the gas-selection
// round-trip @mysten/sui's `Transaction.build()` fires when gas is unpinned (VERIFIED: Enoki's wallet re-parses
// `transaction.toJSON()` — which preserves a pre-set gasData WITHOUT resolving — then calls this SAME
// `build({ client })`, so whatever this proves offline, Enoki inherits). This drives the REAL SDK `commit_turn_ptb`
// through a LANDMINE client (any property access = a build round-trip) and proves:
//   • fully pinned (fight ref + SDK-pinned random/version/clock + gas coin + PRICE + budget) → build is OFFLINE,
//     the landmine is NEVER touched → ZERO round-trips (fix #1 lands, and it confirms the fight/random ARE pinned);
//   • drop the gas PRICE or the PAYMENT → build TOUCHES the client → the exact round-trip fix #1 removes.
// This is the headless regression guard for the whole <1s claim (no live fight needed).
import { describe, expect, test } from 'bun:test'
import { commit_turn_ptb } from '@aresrpg/sdk/fight'

const CTX = { network: 'testnet' }
const FIGHT_REF = { objectId: `0x${'a'.repeat(64)}`, initialSharedVersion: '123', mutable: true } // ensure_fight_shared_ref shape
const CHARACTER = `0x${'b'.repeat(64)}`
const SENDER = `0x${'d'.repeat(64)}`
const COIN = { objectId: `0x${'c'.repeat(64)}`, version: '77', digest: '11111111111111111111111111111111' }

// Any access to `.core` = the resolve plugin reached the client = a build round-trip happened.
const landmine_client = () => ({
  core: new Proxy(
    {},
    {
      get() {
        throw new Error('CLIENT_TOUCHED')
      },
    }
  ),
})

/** Build a move+weapon+pass commit (all inputs the SDK already pins) with a chosen gas pinning, through the landmine. */
async function build_offline({ price = true, payment = true, budget = true }) {
  const tx = commit_turn_ptb(CTX)({
    fight_id: FIGHT_REF, // pinned SharedObjectRef → no fight resolution
    character_id: CHARACTER, // tx.pure.id → no resolution
    actions: [
      { kind: 'move', cell: 5 },
      { kind: 'weapon', target_cell: 9 },
    ],
  })
  tx.setSender(SENDER) // the wallet sets this before build (Enoki: setSenderIfNotSet)
  if (budget) tx.setGasBudget(30_000_000)
  if (payment) tx.setGasPayment([COIN])
  if (price) tx.setGasPrice('1000')
  await tx.build({ client: landmine_client() })
}

describe('gas-coin pin — build round-trip elimination (the <1s mechanism)', () => {
  test('FULLY PINNED (coin + price + budget) → build is OFFLINE (0 round-trips: the landmine never fires)', async () => {
    await expect(build_offline({ price: true, payment: true, budget: true })).resolves.toBeUndefined()
  })

  test('missing gas PRICE → build TOUCHES the client (the round-trip fix #1 removes)', async () => {
    await expect(build_offline({ price: false, payment: true, budget: true })).rejects.toThrow('CLIENT_TOUCHED')
  })

  test('missing gas PAYMENT (the coin) → build TOUCHES the client (gas selection is the round-trip)', async () => {
    await expect(build_offline({ price: true, payment: false, budget: true })).rejects.toThrow('CLIENT_TOUCHED')
  })
})
