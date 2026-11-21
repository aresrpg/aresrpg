// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode } from 'react'
import { Button } from '@aresrpg/ui'
import { Castle, House, KeyRound, Store, Swords, Users } from 'lucide-react'

import { SuinsConfirmation } from '../settings/SuinsConfirmation.tsx'
import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { LocaleScope } from '../i18n/LocaleScope.tsx'
import { dispatch_app, useAppStore } from '../store.ts'
import { LightPage } from '../components/LightPage.tsx'
import { Toasts } from '../components/Toasts.tsx'
import { SessionReplacedModal } from '../components/SessionReplacedModal.tsx'
import { format_sui } from '../wallet_amount.ts'

import { BOT_LOW_BALANCE_MIST } from './account.ts'
import { dapp_text } from './copy.ts'
import { DappConsent } from './DappConsent.tsx'
import { board_stage, DappStage, play_stage, shown_tab, type Stage } from './DappPlay.tsx'
import { keys_held } from './next_step.ts'
import { tab_badges, type DappTab } from './state.ts'
import './dapp.css'

const consent_route = (): boolean => new URLSearchParams(globalThis.location.search).has('authorization_id')

type Props = Readonly<{ copy: AppCopy; locale: Locale }>

/** The dungeon keys the heroes hold, in all. It opens the Raid tab, where each dungeon counts its own. */
const KeyChip = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const keys = useAppStore(({ session }) => keys_held(session.agent_inventory))
  if (keys === null) return null
  return (
    <Button
      className="dapp-chip"
      aria-label={dapp_text(copy, 'keys_chip', { count: String(keys) })}
      data-keys={keys}
      onClick={() => dispatch_app({ type: 'dapp/tab', tab: 'raid' })}
    >
      <KeyRound size={16} aria-hidden="true" />
      {keys}
    </Button>
  )
}

/** What the bot wallet holds. A readout: the wallet menu of the page owns every payment into it. */
const BalanceChip = ({ copy, locale }: Props) => {
  const balance = useAppStore(({ session }) => session.agent_inventory.sui_balance_mist)
  if (balance === null) return null
  const low = balance < BOT_LOW_BALANCE_MIST
  return (
    <span
      className="dapp-chip"
      data-low={low || undefined}
      title={dapp_text(copy, low ? 'bot_balance_low' : 'bot_balance_hint')}
    >
      {dapp_text(copy, 'bot_balance', { amount: format_sui(balance, 2, locale) })}
    </span>
  )
}

/** The dapp's own header readouts: the keys the heroes hold and what the bot wallet holds. */
export const DappChips = ({ copy, locale }: Props) => {
  const signed_in = useAppStore(({ session }) => session.wallet !== null)
  if (!signed_in) return null
  return (
    <>
      <KeyChip copy={copy} />
      <BalanceChip copy={copy} locale={locale} />
    </>
  )
}

const TABS: readonly Readonly<{ tab: DappTab; icon: ReactNode }>[] = [
  { tab: 'home', icon: <House size={18} aria-hidden="true" /> },
  { tab: 'quest', icon: <Swords size={18} aria-hidden="true" /> },
  { tab: 'raid', icon: <Castle size={18} aria-hidden="true" /> },
  { tab: 'heroes', icon: <Users size={18} aria-hidden="true" /> },
  { tab: 'market', icon: <Store size={18} aria-hidden="true" /> },
]

/**
 * The five tabs. Quest and Raid count the heroes that are out on them. The market trades as the bot,
 * so its tab opens only once the bot has answered for the heroes; until then it cannot be pressed.
 */
export const DappTabs = ({ copy, stage }: Readonly<{ copy: AppCopy; stage: Stage }>) => {
  const shown = useAppStore(({ dapp }) => shown_tab(dapp.tab, stage))
  const quest = useAppStore(({ dapp }) => tab_badges(dapp).quest)
  const raid = useAppStore(({ dapp }) => tab_badges(dapp).raid)
  const badges: Readonly<Partial<Record<DappTab, number>>> = { quest, raid }
  return (
    <nav className="dapp-tabs" aria-label={dapp_text(copy, 'nav_label')}>
      {TABS.map(({ tab, icon }) => (
        <Button
          key={tab}
          aria-current={shown === tab ? 'page' : undefined}
          disabled={tab === 'market' && stage !== 'board'}
          data-tab={tab}
          onClick={() => dispatch_app({ type: 'dapp/tab', tab })}
        >
          {icon}
          <span>{dapp_text(copy, `nav_${tab}`)}</span>
          {Boolean(badges[tab]) && (
            <b className="dapp-tab-badge" data-badge={badges[tab]}>
              {badges[tab]}
            </b>
          )}
        </Button>
      ))}
    </nav>
  )
}

/** The gates, then the board with its tabs. The tabs show only once the game server read the bot account. */
const DappBody = ({ copy, locale }: Props) => {
  const stage = useAppStore(play_stage)
  return (
    <>
      {board_stage(stage) && <DappTabs copy={copy} stage={stage} />}
      <DappStage stage={stage} copy={copy} locale={locale} />
    </>
  )
}

/**
 * The engine-less surface: one header with the bot's keys and balance, five tabs, and the shared
 * toasts. Below 960px the tabs are a bar at the bottom of the screen.
 */
export const DappPage = ({ copy, locale }: Props) => {
  // One connection per account: the 3D game opened elsewhere takes this page's place, and says so here.
  const replaced = useAppStore(({ session }) => session.link_status === 'replaced')
  // The game's own components on this page (market, character tabs, creation form) format through the scope.
  return (
    <LocaleScope locale={locale}>
      <LightPage
        wide
        aura="moss"
        brand={
          <>
            <strong>AresRPG</strong>
            <span>{dapp_text(copy, 'brand')}</span>
          </>
        }
        controls={<DappChips copy={copy} locale={locale} />}
        copy={copy}
      >
        <div className="dapp" lang={locale}>
          {consent_route() ? (
            <>
              <DappConsent copy={copy} linked={<DappBody copy={copy} locale={locale} />} />
              <SuinsConfirmation copy={copy} />
            </>
          ) : (
            <DappBody copy={copy} locale={locale} />
          )}
        </div>
        {replaced && <SessionReplacedModal copy={copy} />}
        <Toasts />
      </LightPage>
    </LocaleScope>
  )
}
