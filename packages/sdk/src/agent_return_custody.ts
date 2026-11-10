// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { fight_checkpoint_phase_rank } from '@aresrpg/protocol/fight-phase'
import { type CharacterRow, type FightResolutionRow, type FightStateRow, type ItemRow } from '@aresrpg/protocol'

import type { Sdk } from './client.ts'
import type { KioskCapLoader } from './kiosk_runner.ts'
import { fight_actions } from './fight.ts'
import { dungeon_actions } from './dungeon.ts'
import { kolizeum_actions } from './kolizeum.ts'
import { tournament_actions } from './tournament.ts'

export type AgentReturnProjection = Readonly<{
  characters: readonly CharacterRow[]
  inventory: readonly ItemRow[]
  fights: Readonly<Record<string, FightStateRow>>
  resolutions: readonly FightResolutionRow[]
}>
export type ReturnProjectionReader = (
  accept?: (snapshot: AgentReturnProjection) => boolean
) => Promise<AgentReturnProjection>

/** Use the existing fight and dungeon doors. Ended custody settles; active custody forfeits. */
export const return_character_custody = async (
  sdk: Sdk,
  kiosk_cap: KioskCapLoader,
  address: string,
  read: ReturnProjectionReader
) => {
  const fight = fight_actions(sdk, { kiosk_cap })
  const dungeon = dungeon_actions(sdk, { kiosk_cap })
  const kolizeum = kolizeum_actions(sdk, { kiosk_cap, address })
  const tournament = tournament_actions(sdk, { kiosk_cap })
  const settle = (row: FightResolutionRow, character: CharacterRow) => {
    const common = { fight: row.fight, custody: { kiosk: character.kiosk }, fighter_idx: BigInt(row.fighter) }
    if (row.tournament)
      return tournament.settle({ ...common, tournament: row.tournament.id, index: row.tournament.index })
    if (row.kolizeum) return kolizeum.settle({ ...common, kolizeum: row.kolizeum })
    const input = {
      ...common,
      settlements: [
        { fighter_idx: common.fighter_idx, loot: row.loot_types.map((item_type) => ({ item_type, existing: null })) },
      ],
      boss_rewards: row.boss_weight > 0,
    }
    return row.dungeon ? dungeon.settle({ ...input, dungeon: row.dungeon }) : fight.settle(input)
  }
  const leave = (character: CharacterRow, state: FightStateRow) => {
    const active = character.active_fight!
    const input = { fight: active.id, fighter_idx: BigInt(active.seat), custody: { kiosk: character.kiosk } }
    if (state.tournament) return tournament.forfeit(input)
    if (state.kolizeum)
      return fight_checkpoint_phase_rank(state.contract) === 0
        ? kolizeum.exit({ ...input, kolizeum: state.kolizeum.id })
        : kolizeum.forfeit(input)
    return character.dungeon_run ? dungeon.give_up_fight(input) : fight.forfeit(input)
  }
  const initial = await read()
  for (const selected of initial.characters) {
    let current = (await read()).characters.find(({ id }) => id === selected.id)
    if (!current) continue
    if (current.active_fight) {
      const { id } = current.active_fight
      const snapshot = await read((value) => !!value.fights[id])
      const state = snapshot.fights[id]!
      if (fight_checkpoint_phase_rank(state.contract) === 2) {
        const terminal = await read((value) =>
          value.resolutions.some((row) => row.character === selected.id && !row.settled)
        )
        await settle(
          terminal.resolutions.find((row) => row.character === selected.id && !row.settled)!,
          current
        )
      } else await leave(current, state)
      current = (
        await read((value) => !value.characters.find(({ id }) => id === selected.id)?.active_fight)
      ).characters.find(({ id }) => id === selected.id)
    }
    if (current?.dungeon_run) {
      await dungeon.abandon({ character_id: current.id, custody: { kiosk: current.kiosk } })
      await read((value) => !value.characters.find(({ id }) => id === selected.id)?.dungeon_run)
    }
  }
}
