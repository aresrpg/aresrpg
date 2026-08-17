// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type DoorStrategy =
  | { kind: 'skip' | 'clock' | 'random' }
  | { kind: 'pin'; pin: string; mutable?: boolean }
  | { kind: 'pure' | 'pure_option' | 'pure_vector'; helper: string }
  | { kind: 'move_vector' }
  | { kind: 'receiving'; type: string }
  | { kind: 'object'; type: string; mutable: boolean }

export type ParsedDoor = {
  name: string
  params: { name: string; type: string; strategy: DoorStrategy }[]
  module?: string
  package_key?: string
  export_name?: string
}

export const API_MOVE_PATH: string
export const DOORS_OUT_PATH: string
export const CHARACTER_MOVE_PATH: string
export const CHARACTER_PRICE_OUT_PATH: string
export function parse_doors(move_source: string, include_names?: ReadonlySet<string> | null): ParsedDoor[]
export function emit_doors(doors: ParsedDoor[], options?: Readonly<{ source?: string; description?: string }>): string
export function generate_projected_doors(
  doors: ParsedDoor[],
  output_path: string,
  options?: Readonly<{ source?: string; description?: string }>
): Promise<string>
export function generate(move_source: string): Promise<string>
export function generate_character_price(move_source: string): Promise<string>
