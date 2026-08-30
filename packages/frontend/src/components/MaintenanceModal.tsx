// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { env } from '../env.ts'
import type { AppCopy } from '../i18n/copy.ts'

export const MaintenanceModal = ({ copy }: Readonly<{ copy: AppCopy }>) => (
  <section
    aria-labelledby="game-maintenance-title"
    aria-modal="true"
    className="pointer-events-auto fixed inset-0 z-[195] grid place-items-center bg-bg/92 p-5 backdrop-blur-xl"
    data-game-maintenance=""
    role="alertdialog"
  >
    <div className="relative w-full max-w-lg overflow-hidden border border-[#f04438]/45 bg-[linear-gradient(145deg,rgba(45,14,18,0.98),rgba(31,18,18,0.98)_55%,rgba(48,27,12,0.98))] p-7 shadow-[0_0_90px_rgba(240,68,56,0.2)]">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#d92d20] to-[#f79009]" />
      <p className="text-[8px] tracking-[0.24em] text-[#f79009] uppercase">AresRPG</p>
      <h2 id="game-maintenance-title" className="mt-3 text-base font-semibold text-[#fff1e8]">
        {copy.game_maintenance_title}
      </h2>
      <p className="mt-3 text-[11px] leading-6 text-[#d9b8ae]">{copy.game_maintenance_body}</p>
      <a
        className="mt-6 inline-flex h-10 items-center border border-[#f79009]/45 bg-[#f79009]/10 px-5 text-[9px] tracking-[0.16em] text-[#ffb35c] uppercase transition hover:border-[#ffb35c]/70 hover:bg-[#f79009]/16"
        href={env.discord_url}
        rel="noopener noreferrer"
        target="_blank"
      >
        {copy.join_discord}
      </a>
    </div>
  </section>
)
