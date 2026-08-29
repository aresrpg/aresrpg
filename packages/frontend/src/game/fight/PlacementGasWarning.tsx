// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { HydratedFightCheckpoint } from '@aresrpg/fight'
import { useState, type ReactNode } from 'react'

import { ModalFrame } from '../../components/ModalFrame.tsx'
import type { GameSettings } from '../core/settings.ts'
import { dispatch_app } from '../../store.ts'

type PlacementIntent = Readonly<{ fight: string; fighter: bigint; cell: bigint }>

export const placement_click_decision = (already_changed: boolean, warning_disabled: boolean): 'submit' | 'warn' =>
  already_changed && !warning_disabled ? 'warn' : 'submit'

export const placement_available = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  fighter: bigint,
  cell: bigint
): boolean => {
  const row = checkpoint.contract.fighters[Number(fighter)]
  const starts = row?.team === 0n ? checkpoint.contract.board.start_cells_a : checkpoint.contract.board.start_cells_b
  return (
    !!row &&
    !row.ready &&
    starts.includes(cell) &&
    !checkpoint.contract.fighters.some((candidate) => candidate.cell === cell)
  )
}

const PlacementGasWarning = ({
  cancel,
  checked,
  close,
  confirm,
  disabled,
  set_checked,
  text,
}: Readonly<{
  cancel: string
  checked: boolean
  close: () => void
  confirm: () => void
  disabled: boolean
  set_checked: (checked: boolean) => void
  text: Readonly<Record<string, string>>
}>) => (
  <ModalFrame close={close} close_label={cancel} label={text.placement_gas_title ?? ''} max_width="max-w-sm" soft>
    <div className="p-7">
      <h2 className="text-sm font-semibold tracking-[0.16em] text-[#f0c36a] uppercase">{text.placement_gas_title}</h2>
      <p className="mt-4 text-[11px] leading-6 text-[#c5c0b8]">{text.placement_gas_body}</p>
      <label className="mt-5 flex cursor-pointer items-center gap-3 text-[9px] tracking-[0.1em] text-[#a3a5ad] uppercase">
        <input
          checked={checked}
          className="size-4 accent-[#c8963c]"
          onChange={(event) => set_checked(event.target.checked)}
          type="checkbox"
        />
        {text.placement_gas_hide}
      </label>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          className="h-11 cursor-pointer rounded-lg border border-white/10 bg-white/3 text-[9px] tracking-[0.16em] uppercase transition hover:bg-white/7"
          onClick={close}
          type="button"
        >
          {cancel}
        </button>
        <button
          className="h-11 cursor-pointer rounded-lg border border-[#c8963c]/40 bg-[#241b0d]/90 text-[9px] tracking-[0.16em] text-[#f0c36a] uppercase transition hover:bg-[#342712] disabled:cursor-not-allowed disabled:opacity-45"
          disabled={disabled}
          onClick={confirm}
          type="button"
        >
          {text.placement_gas_confirm}
        </button>
      </div>
    </div>
  </ModalFrame>
)

export const usePlacementGasWarning = ({
  actions_locked,
  cancel,
  changed_seats,
  checkpoint,
  settings,
  text,
}: Readonly<{
  actions_locked: boolean
  cancel: string
  changed_seats: Readonly<Record<number, true>>
  checkpoint: Readonly<HydratedFightCheckpoint> | null
  settings: GameSettings
  text: Readonly<Record<string, string>>
}>): Readonly<{ place: (fight: string, fighter: bigint, cell: bigint) => void; warning: ReactNode }> => {
  const [intent, set_intent] = useState<PlacementIntent | null>(null)
  const [hide, set_hide] = useState(false)
  const submit = (placement: PlacementIntent): void => {
    const remember = hide
    set_intent(null)
    set_hide(false)
    if (
      actions_locked ||
      !checkpoint ||
      checkpoint.contract.id !== placement.fight ||
      !placement_available(checkpoint, placement.fighter, placement.cell)
    )
      return
    if (remember)
      dispatch_app({
        type: 'settings/changed',
        settings: Object.freeze({ ...settings, placement_gas_warning_disabled: true }),
      })
    dispatch_app({
      type: 'fight/input',
      fight: placement.fight,
      origin: 'local',
      input: { type: 'place', fighter: placement.fighter, cell: placement.cell },
    })
  }
  const place = (fight: string, fighter: bigint, cell: bigint): void => {
    if (!checkpoint || checkpoint.contract.id !== fight || !placement_available(checkpoint, fighter, cell)) return
    const placement = Object.freeze({ fight, fighter, cell })
    if (
      placement_click_decision(
        changed_seats[Number(placement.fighter)] === true,
        settings.placement_gas_warning_disabled === true
      ) === 'warn'
    ) {
      set_hide(false)
      set_intent(placement)
      return
    }
    submit(placement)
  }
  const warning = intent && intent.fight === checkpoint?.contract.id && (
    <PlacementGasWarning
      cancel={cancel}
      checked={hide}
      close={() => set_intent(null)}
      confirm={() => submit(intent)}
      disabled={actions_locked}
      set_checked={set_hide}
      text={text}
    />
  )
  return Object.freeze({ place, warning })
}
