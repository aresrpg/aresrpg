// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export { create_fight } from './fight.ts'
export {
  create_character_source,
  create_fight_state,
  create_mob_snapshot,
  mob_scalar_for_level,
  player_max_hp,
} from './create.ts'
export { generate_board } from './board_gen.ts'
export { project_board_cells } from './board.ts'
export { decode_fight_action, encode_fight_action, fight_action_to_wire, parse_fight_wire_action } from './wire.ts'
export { CONTRACT_CONSTANTS, MOVE_SOURCE_HASH } from './move_contract.gen.ts'
export type { FightBoardCell, FightBoardCellKind } from './board.ts'
export type {
  Fight,
  FightCommandInput,
  FightInput,
  FightMode,
  FightResult,
  TurnSeedInput,
  TurnWitness,
} from './fight.ts'
export type { CharacterSourceInput, FightSetup } from './types.ts'
export type { FightStreamInput, FightWireAction } from './wire.ts'
export type * from './types.ts'
