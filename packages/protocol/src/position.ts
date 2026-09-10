// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type ChainAnchor = Readonly<{ x: number; z: number; at_ms: number }>

/** Movement is meaningful only against the exact chain checkpoint that authorized it. */
export const position_checkpoint = (world: string, anchor: ChainAnchor): string =>
  `${world}:${anchor.x}:${anchor.z}:${anchor.at_ms}`

export const character_checkpoint = (
  character: Readonly<{ world?: string; checkpoint_world?: string; x?: number; z?: number; at_ms?: number }>
): string | null =>
  character.world &&
  character.world === character.checkpoint_world &&
  Number.isFinite(character.x) &&
  Number.isFinite(character.z)
    ? position_checkpoint(character.world, { x: character.x!, z: character.z!, at_ms: character.at_ms ?? 0 })
    : null
