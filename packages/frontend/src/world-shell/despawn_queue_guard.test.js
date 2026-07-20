import { describe, expect, test } from 'bun:test'

import { entity_fold_action } from './voxel_fight_folds.js'

const FIGHTER = { id: 'mob-0', dead: true, is_player: false, cell: { x: 5, y: 5 } }
const CONTEXT = {
  has_entity: true,
  is_dying: false,
  walking: false,
  replay_owned: false,
  placed: null,
}

describe('dead fighter queue guard', () => {
  test('queued beats own the rig, while an unqueued corpse still despawns', () => {
    expect(entity_fold_action(FIGHTER, { ...CONTEXT, queued: true })).toEqual({ kind: 'skip' })
    expect(entity_fold_action(FIGHTER, { ...CONTEXT, queued: false })).toEqual({ kind: 'despawn' })
  })
})
