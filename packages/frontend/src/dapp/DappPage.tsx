// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button, SegmentedControl } from '@aresrpg/ui'

import { SuinsConfirmation } from '../settings/SuinsConfirmation.tsx'
import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { LightPage } from '../components/LightPage.tsx'
import { Toasts } from '../components/Toasts.tsx'
import { SessionReplacedModal } from '../components/SessionReplacedModal.tsx'
import { format_sui } from '../wallet_amount.ts'

import { dapp_text } from './copy.ts'
import { DAPP_ROUTE } from './oauth.ts'
import { DappConsent } from './DappConsent.tsx'
import { DappMarket } from './DappMarket.tsx'
import { DappPlay, play_stage } from './DappPlay.tsx'
import type { DappMode } from './state.ts'
import './dapp.css'

const consent_route = (): boolean => new URLSearchParams(globalThis.location.search).has('authorization_id')

/** The dapp's own header controls: its mode, its two views and what the bot wallet holds. */
const DappControls = ({ copy, locale }: Readonly<{ copy: AppCopy; locale: Locale }>) => {
  const mode = useAppStore(({ dapp }) => dapp.mode)
  const view = useAppStore(({ dapp }) => dapp.view)
  const signed_in = useAppStore(({ session }) => session.wallet !== null)
  const balance = useAppStore(({ session }) => session.agent_inventory.sui_balance_mist)
  const text = (key: string, values?: Readonly<Record<string, string>>) => dapp_text(copy, key, values)
  return (
    <>
      <SegmentedControl<DappMode>
        label={text('mode_label')}
        value={mode}
        on_change={(next) => dispatch_app({ type: 'dapp/mode', mode: next })}
        options={[
          { value: 'basic', label: text('mode_basic') },
          { value: 'advanced', label: text('mode_advanced') },
        ]}
      />
      <nav className="dapp-nav" aria-label={text('nav_label')}>
        <Button aria-pressed={view === 'play'} onClick={() => dispatch_app({ type: 'dapp/view', view: 'play' })}>
          {text('nav_play')}
        </Button>
        <Button aria-pressed={view === 'market'} onClick={() => dispatch_app({ type: 'dapp/view', view: 'market' })}>
          {text('nav_market')}
        </Button>
      </nav>
      {signed_in && balance !== null && (
        <span className="dapp-chip" title={text('bot_balance_hint')}>
          {text('bot_balance', { amount: format_sui(balance, 2, locale) })}
        </span>
      )}
    </>
  )
}

/**
 * The engine-less surface: one header, the play view or the bot account's market, and the shared toasts.
 * The market trades as the bot, so it opens only once the bot's heroes are observed; before that the
 * play view shows the gate that is still closed.
 */
export const DappPage = ({ copy, locale }: Readonly<{ copy: AppCopy; locale: Locale }>) => {
  const market = useAppStore((state) => state.dapp.view === 'market' && play_stage(state) === 'board')
  // One connection per account: the 3D game opened elsewhere takes this page's place, and says so here.
  const replaced = useAppStore(({ session }) => session.link_status === 'replaced')
  return (
    <LightPage
      aura="moss"
      brand={
        <>
          <strong>AresRPG</strong>
          <span>{dapp_text(copy, 'brand')}</span>
        </>
      }
      controls={<DappControls copy={copy} locale={locale} />}
      copy={copy}
    >
      <div className="dapp" lang={locale}>
        {consent_route() ? (
          <>
            <DappConsent copy={copy} />
            <SuinsConfirmation copy={copy} />
          </>
        ) : market ? (
          <DappMarket copy={copy} locale={locale} />
        ) : (
          <DappPlay copy={copy} locale={locale} />
        )}
      </div>
      {replaced && <SessionReplacedModal copy={copy} />}
      <Toasts />
    </LightPage>
  )
}
