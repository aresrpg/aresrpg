// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ServerPacket } from './packets.ts'

export type FightPhaseRank = 0 | 1 | 2

export const fight_checkpoint_phase_rank = (contract: unknown): FightPhaseRank => {
  if (!contract || typeof contract !== 'object') return 0
  return Reflect.get(contract, 'ended') === true ? 2 : Number(Reflect.get(contract, 'round') ?? 0) > 0 ? 1 : 0
}

export const fight_state_regresses = (floor: FightPhaseRank, contract: unknown) =>
  fight_checkpoint_phase_rank(contract) < floor

export const fight_packet_phase = (packet: ServerPacket): Readonly<{ fight: string; rank: FightPhaseRank }> | null => {
  switch (packet.type) {
    case 'packet/fight_state':
      return { fight: packet.fight, rank: fight_checkpoint_phase_rank(packet.state.contract) }
    case 'packet/fight_started':
      return { fight: packet.fight, rank: 1 }
    case 'packet/fight_ended':
      return { fight: packet.fight, rank: 2 }
    case 'packet/fight_phase':
      return { fight: packet.fight, rank: packet.phase === 'ended' ? 2 : 1 }
    default:
      return null
  }
}
