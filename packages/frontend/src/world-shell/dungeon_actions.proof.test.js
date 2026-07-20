import { readFileSync } from 'node:fs'

import { afterAll, describe, expect, test } from 'bun:test'

import i18n from '../i18n'
import { install_browser_globals } from '../test_helpers/browser_globals.js'
import { parse_move_abort, humanize_tx_error } from '../game/core/abort_copy.js'

// dungeon_actions imports the browser wallet graph at module load; this scoped pure-helper test supplies only
// that graph's host surface and never initializes or calls a wallet.
const restore_browser_globals = install_browser_globals()

// SIZE-LAW SPLIT (2026-07-20): verified_world_group_proof + create_world_fight moved to dungeon_engage_actions.js.
const { verified_world_group_proof } = await import('./dungeon_engage_actions.js')
const dungeon_engage_actions_source = readFileSync(new URL('./dungeon_engage_actions.js', import.meta.url), 'utf8')

afterAll(restore_browser_globals)

const hex_bytes = (hex) => Array.from(Uint8Array.fromHex(hex))
const groups = [
  { index: 0, spawn_id: '21', template_id: '0x1f', x: 41, z: 51, size: 2, group_seed: '61' },
  { index: 1, spawn_id: '22', template_id: '0x20', x: 42, z: 52, size: 3, group_seed: '62' },
  { index: 2, spawn_id: '23', template_id: '0x21', x: 43, z: 53, size: 4, group_seed: '63' },
]
const base = {
  world_id: '0x1',
  spawn_id: '23',
  mob_template_id: '0x21',
  zx: 7,
  zy: 9,
  zone: { seed: '11', discovered_at_ms: 13, mob_bitmap: [] },
  commitment: {
    count: 3,
    root: hex_bytes('34aa456447c6815ec68a56bed6363cb42d714f8ab605dfddb35d6aa29dd213db'),
  },
  groups,
}

describe('world fight proof attachment', () => {
  test('attaches only the locally verified full-stream witness', () => {
    const witness = verified_world_group_proof(base)
    expect(witness?.index).toBe(2)
    expect(witness?.proof).toEqual(
      hex_bytes(
        'c75b70b9207525ec6dc3baca7219cad412e62ee0ce9516e034a49d576a045d21' +
          'ca47040173b19e32ec5c387f00afbf58b30a69b7e95011cf875ce6772d5f4da2'
      )
    )
  })

  test('returns null for a root mismatch or consumed target', () => {
    const bad_root = [...base.commitment.root]
    bad_root[0] ^= 1
    expect(verified_world_group_proof({ ...base, commitment: { ...base.commitment, root: bad_root } })).toBeNull()
    expect(verified_world_group_proof({ ...base, zone: { ...base.zone, mob_bitmap: [0b100] } })).toBeNull()
  })
})

// TOCTOU SHRINK (leg ③, regression 2026-07-19): the create_world_fight engage flow re-verifies the group is still
// unclaimed via a FRESH /v1/fights read IMMEDIATELY before compose/sign — so a poll-lag race (the affordance's 6s
// snapshot said "engageable" but another account just claimed it) refuses PRE-SIGN (zero gas), never composing the
// doomed tx a second account burned gas on. create_world_fight is an IO orchestrator, so the ordering is
// locked by source shape (the module's own convention); the refusal SHAPE is proven behaviorally.
describe('world fight pre-sign liveness re-check', () => {
  test('the fresh /v1 fight read + refuse are wired BEFORE compose and BEFORE sign (no doomed submit)', () => {
    const read_at = dungeon_engage_actions_source.indexOf('get_fights({ world: world_id })')
    const refuse_at = dungeon_engage_actions_source.indexOf(
      'if (group_engage_blocked(live_fights, spawn_id)) throw tx_error('
    )
    const compose_at = dungeon_engage_actions_source.indexOf('create_fight_ptb(ctx_of(sdk))(', refuse_at)
    const sign_at = dungeon_engage_actions_source.indexOf("await sign(tx, i18n.t('fights.action_engage')", refuse_at)
    expect(read_at, 'the re-check reads the SAME /v1 fight truth the affordance uses').toBeGreaterThan(-1)
    expect(refuse_at, 'a live fight on the spawn refuses pre-sign').toBeGreaterThan(-1)
    expect(compose_at, 'the refuse precedes compose (create_fight_ptb)').toBeGreaterThan(refuse_at)
    expect(sign_at, 'the refuse precedes submit (sign)').toBeGreaterThan(refuse_at)
  })

  test('the refusal shape decodes to the honest 108 reason AND the ghost key engage() reconciles on', () => {
    // create_world_fight throws tx_error(GROUP_CLAIMED_ABORT, { preflight: true }); this is that exact structured
    // shape. It must humanize to the "already taken" copy (the decoded reason) AND parse as zones/108 so engage()'s
    // catch ghost-drops the row + re-polls — identical reconciliation to a real on-chain claim race, minus the burn.
    const GROUP_CLAIMED_ABORT = { MoveAbort: { abortCode: 108, location: { module: 'zones' } } }
    expect(parse_move_abort(GROUP_CLAIMED_ABORT)).toMatchObject({ module: 'zones', code: 108 })
    expect(humanize_tx_error(GROUP_CLAIMED_ABORT)).toBe(i18n.t('errors.fight_group_claimed'))
  })
})
