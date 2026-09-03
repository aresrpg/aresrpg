// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  BookOpen,
  Crosshair,
  Gamepad2,
  Gift,
  Gem,
  Settings,
  ShieldCheck,
  Store,
  Swords,
  Trophy,
  type LucideIcon,
} from 'lucide-react'

import { version } from '../../../../package.json'
import type { AppCopy } from '../i18n/copy.ts'
import type { Network } from '../env.ts'
import type { Page } from '../modules/navigation.ts'
import { is_admin_address } from '../admin_access.ts'

type CopyStringKey = { [K in keyof AppCopy]: AppCopy[K] extends string ? K : never }[keyof AppCopy]

const NAVIGATION: readonly Readonly<{ page: Page; label: CopyStringKey; Icon: LucideIcon; disabled: boolean }>[] =
  Object.freeze([
    { page: 'world', label: 'world', Icon: Gamepad2, disabled: false },
    { page: 'characters', label: 'characters', Icon: Swords, disabled: false },
    { page: 'leaderboard', label: 'leaderboard', Icon: Trophy, disabled: true },
    { page: 'mastery', label: 'mastery', Icon: Gem, disabled: false },
    { page: 'encyclopedia', label: 'encyclopedia', Icon: BookOpen, disabled: false },
    { page: 'marketplace', label: 'marketplace', Icon: Store, disabled: false },
    { page: 'airdrop', label: 'airdrop', Icon: Gift, disabled: false },
    { page: 'kolizeum', label: 'kolizeum', Icon: Crosshair, disabled: false },
    { page: 'settings', label: 'settings', Icon: Settings, disabled: false },
    { page: 'admin', label: 'admin', Icon: ShieldCheck, disabled: false },
  ])

type SidebarProps = Readonly<{
  copy: AppCopy
  page: Page
  open_page: (page: Page) => void
  address: string | null
  network: Network
  mastery_notification?: boolean
}>

export const Sidebar = ({ copy, page, open_page, address, network, mastery_notification = false }: SidebarProps) => (
  <aside
    data-app-sidebar=""
    className="pointer-events-auto flex w-[200px] shrink-0 flex-col border border-border bg-surface/80"
  >
    <div className="flex items-center justify-center gap-2.5 border-b border-border py-5">
      <img className="size-7 drop-shadow-[0_0_12px_rgba(200,150,60,0.3)]" src="/logo.png" alt="AresRPG" />
      <span className="flex flex-col items-start gap-1.5">
        <span className="bg-[linear-gradient(135deg,#fad9b3_0%,#d4a145_50%,#f0c474_100%)] bg-clip-text text-[11px] font-bold tracking-[0.3em] text-transparent uppercase">
          AresRPG
        </span>
        <span className="flex items-center gap-1.5">
          {network === 'testnet' && (
            <span className="border border-[#ff5a8b]/45 bg-[#ff5a8b]/10 px-1.5 py-px text-[7px] font-black tracking-[0.25em] text-[#ff6fa8] uppercase shadow-[0_0_10px_rgba(255,90,139,0.12)]">
              {copy.network_testnet}
            </span>
          )}
          <span className="border border-white/12 bg-white/4 px-1.5 py-px text-[7px] font-black tracking-[0.25em] text-[#8d9099] uppercase">
            v{version}
          </span>
        </span>
      </span>
    </div>
    <nav className="flex min-h-0 flex-1 flex-col py-3">
      <div className="px-4 pb-2 text-[9px] tracking-[0.2em] text-[#6b7280] uppercase">{copy.navigation}</div>
      {NAVIGATION.filter((item) => item.page !== 'admin' || is_admin_address(address)).map((item) => (
        <button
          className={`flex w-full items-center gap-3 border-l-2 px-4 py-2.5 text-left transition-all duration-200 ${
            item.disabled
              ? 'cursor-not-allowed border-transparent text-[#6b7280] opacity-40'
              : page === item.page
                ? 'cursor-pointer border-[#c8963c] bg-[#c8963c]/8 text-[#c8963c]'
                : item.page === 'mastery' && mastery_notification
                  ? 'cursor-pointer border-[#dc3152]/45 bg-[#dc3152]/[0.045] text-[#9397a2] hover:bg-[#dc3152]/[0.075] hover:text-[#e8e4dc]'
                  : 'cursor-pointer border-transparent text-[#6b7280] hover:bg-[#c8963c]/5 hover:text-[#e8e4dc]'
          }`}
          disabled={item.disabled}
          data-page={item.page}
          key={item.page}
          onClick={() => open_page(item.page)}
          type="button"
        >
          <item.Icon aria-hidden="true" className="opacity-60" size={14} />
          <span className="min-w-0 flex-1 text-[11px] tracking-[0.15em] uppercase">{copy[item.label]}</span>
          {item.page === 'mastery' && mastery_notification && (
            <span
              aria-hidden="true"
              className="relative grid size-3.5 place-items-center rounded-full border border-[#ff9aab] bg-[#dc3152] text-[7px] font-black leading-none text-white shadow-[0_0_7px_rgba(255,49,87,0.6)]"
              data-nav-notification="mastery"
            >
              <span className="absolute -inset-0.5 animate-ping rounded-full bg-[#ff3157]/30" />
              <span className="relative">1</span>
            </span>
          )}
        </button>
      ))}
    </nav>
  </aside>
)
