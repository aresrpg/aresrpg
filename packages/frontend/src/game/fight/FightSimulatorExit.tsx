// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { RotateCcw } from 'lucide-react'
import type { AppCopy } from '../../i18n/copy.ts'
import { dispatch_app } from '../../store.ts'

export const FightSimulatorExit = ({
  copy,
  visible,
  label,
}: Readonly<{ copy: AppCopy; visible: boolean; label?: string | null }>) => {
  if (!visible || label === null) return null
  return (
    <button
      className="pointer-events-auto absolute top-3 right-3 z-10 flex cursor-pointer items-center gap-2 border border-white/10 bg-black/55 px-3 py-2 text-[8px] tracking-[0.14em] text-[#a3a5ad] uppercase backdrop-blur hover:border-[#c8963c]/40 hover:text-[#c8963c]"
      onClick={() => dispatch_app({ type: 'fight/closed', fight: null })}
      type="button"
    >
      <RotateCcw size={12} /> {label ?? copy.simulator_page.back_to_setup}
    </button>
  )
}
