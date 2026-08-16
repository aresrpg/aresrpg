// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One roster row, shared by the left roster and the blue-cell picker.

import type { SimulatorCharacter } from '../modules/simulator.ts'

export const CharacterRow = ({
  character,
  level_label,
  active = false,
  right,
}: Readonly<{
  character: SimulatorCharacter
  level_label: string
  active?: boolean
  right?: React.ReactNode
}>) => (
  <>
    <span className="grid size-[34px] shrink-0 place-items-center overflow-hidden border border-white/8 bg-white/2">
      <span className="text-[13px] text-[#c8963c]">{character.name.slice(0, 1).toUpperCase()}</span>
    </span>
    <span className="flex min-w-0 flex-1 flex-col">
      <span className={`truncate text-[11px] ${active ? 'text-[#c8963c]' : 'text-[#e8e4dc]'}`}>{character.name}</span>
      <span className="truncate text-[8px] tracking-[0.16em] text-[#6b7280] uppercase">{character.classe}</span>
      <span className="text-[8px] tracking-[0.16em] text-[#c8963c]/70 uppercase">{level_label}</span>
    </span>
    <span className="flex h-7 shrink-0 gap-0.5">
      {character.colors.map((color, index) => (
        <span className="w-1.5" key={index} style={{ backgroundColor: color }} />
      ))}
    </span>
    {right}
  </>
)
