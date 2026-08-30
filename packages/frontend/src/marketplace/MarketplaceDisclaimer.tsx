// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Gamepad2, ShieldCheck, TrendingDown } from 'lucide-react'

const notice_rows = Object.freeze([
  Object.freeze({ key: 'disclaimer_supply', Icon: TrendingDown, color: '#ef9a5a' }),
  Object.freeze({ key: 'disclaimer_fun', Icon: Gamepad2, color: '#67adff' }),
  Object.freeze({ key: 'disclaimer_wallet', Icon: ShieldCheck, color: '#65c993' }),
])

export const MarketplaceDisclaimer = ({
  text,
  acknowledge,
}: Readonly<{ text: (key: string) => string; acknowledge: () => void }>) => (
  <section
    className="pointer-events-auto relative grid min-h-full min-w-0 flex-1 place-items-center overflow-y-auto border border-border bg-surface/98 p-6"
    data-marketplace-disclaimer=""
  >
    <div className="w-full max-w-2xl border border-white/10 border-t-[#c8963c] bg-bg/94 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
      <p className="text-[8px] tracking-[0.28em] text-[#c8963c] uppercase">{text('disclaimer_kicker')}</p>
      <h1 className="mt-3 text-xl font-semibold tracking-[0.04em] text-[#e8e4dc]">{text('disclaimer_title')}</h1>
      <p className="mt-4 text-[11px] leading-6 text-[#9da0a9]">{text('disclaimer_body')}</p>
      <div className="mt-6 space-y-2">
        {notice_rows.map(({ key, Icon, color }) => (
          <div className="flex items-start gap-3 border border-white/7 bg-white/[0.018] px-4 py-3" key={key}>
            <Icon aria-hidden="true" className="mt-0.5 shrink-0" color={color} size={15} strokeWidth={1.6} />
            <p className="text-[10px] leading-5 text-[#a8abb3]">{text(key)}</p>
          </div>
        ))}
      </div>
      <button
        className="mt-7 h-11 w-full cursor-pointer border border-[#c8963c]/45 bg-[#c8963c]/10 text-[9px] font-semibold tracking-[0.18em] text-[#efbd45] uppercase transition hover:border-[#efbd45]/70 hover:bg-[#c8963c]/16"
        onClick={acknowledge}
        type="button"
      >
        {text('disclaimer_acknowledge')}
      </button>
    </div>
  </section>
)
