// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type DoorStrategy =
  | { kind: 'skip' | 'clock' | 'random' }
  | { kind: 'pin'; pin: string; mutable?: boolean }
  | { kind: 'pure' | 'pure_option' | 'pure_vector'; helper: string }
  | { kind: 'move_value' | 'move_vector'; type: string }
  | { kind: 'receiving'; type: string }
  | { kind: 'object'; type: string; mutable: boolean }

export type ParsedDoor = {
  name: string
  params: { name: string; type: string; strategy: DoorStrategy }[]
  module?: string
  package_key?: string
  export_name?: string
  token?: boolean
}

export const API_MOVE_PATH: string
export const TOURNAMENT_MOVE_PATH: string
export const TOURNAMENT_BRACKET_PATH: string
export const TRADE_MOVE_PATH: string
export const DOORS_OUT_PATH: string
export const TOURNAMENT_RULES_OUT_PATH: string
export const CHARACTER_MOVE_PATH: string
export const CHARACTER_PRICE_OUT_PATH: string
export function parse_doors(move_source: string, include_names?: ReadonlySet<string> | null): ParsedDoor[]
export function generate_projected_doors(
  doors: ParsedDoor[],
  output_path: string,
  options?: Readonly<{ source?: string; description?: string; size_note?: string }>
): Promise<string>
export function generate_game_doors(
  api_source: string,
  trade_source: string,
  tournament_source: string
): Promise<string>
export function generate_tournament_rules(source: string, bracket_source: string): Promise<string>
export function generate_character_price(move_source: string): Promise<string>
