// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The portfolio: what the player owns on the game account and on the bot account, and what each can do.
import { useMemo, useState, type ReactNode } from 'react'
import type { CharacterRow } from '@aresrpg/protocol'
import { Button, SegmentedControl } from '@aresrpg/ui'
import { Backpack, Download, Shield, Tag } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

import { AgentSetupButton } from '../agents/AgentSetup.tsx'
import { AgentTransferFunding } from '../agents/AgentTransferFunding.tsx'
import { send_character_to_agent } from '../agents/send_character.ts'
import { useAgentKiosk } from '../agents/useAgentKiosk.ts'
import { useCharacterRecall } from '../agents/useCharacterRecall.tsx'
import { ItemDetailContext } from '../components/ItemDetailContext.ts'
import { bot_pairing, shown_wallet, WalletCard, type WalletShown } from '../components/WalletCard.tsx'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { HistoryPanel } from '../marketplace/HistoryPanel.tsx'
import { OwnListings } from '../marketplace/OwnListings.tsx'
import { SaleDialog } from '../marketplace/SaleDialog.tsx'
import { useMarketSell } from '../marketplace/useMarketSell.ts'
import type { SessionState } from '../modules/session.ts'
import { SignInStage, useSignInStage } from '../site/SignIn.tsx'
import { dispatch_app, useSiteStore } from '../store.ts'

import { Bag, BAG } from './Bag.tsx'
import { bag_account, bag_cells, bag_items } from './bag.ts'
import { HeroCard, HEROES, HeroSkeleton, type HeroMove } from './HeroCard.tsx'
import './portfolio.css'

type Tab = 'heroes' | 'bag' | 'for_sale'
/** A sentence in place of a tab's content. */
const NOTE = 'py-6 leading-normal'
type Phase = 'loading' | 'ready' | 'failed'

/** Whether the account on screen has answered. The bot's heroes are the ones its recall reads. */
const account_phase = (session: SessionState, on_bot: boolean): Phase => {
  if (!on_bot) return session.roster_loaded ? 'ready' : 'loading'
  const { phase } = session.agent_inventory
  return phase === 'idle' ? 'loading' : phase
}

/** The boxes the account fills: two hero cards, one row of bag cells. */
const WAITING = Object.freeze({
  heroes: () => (
    <div className={HEROES} aria-busy="true">
      <HeroSkeleton />
      <HeroSkeleton />
    </div>
  ),
  bag: () => (
    <div className={BAG} aria-busy="true">
      {Array.from({ length: 8 }, (_, index) => (
        <span key={index} className="aui-skeleton size-16" />
      ))}
    </div>
  ),
})

/** A sentence in place of the content: the account failed to load, or it holds nothing of this kind. */
const AccountNote = ({ copy, phase, empty }: Readonly<{ copy: AppCopy; phase: Phase; empty: string }>) => (
  <p
    className={`${NOTE} ${phase === 'failed' ? 'text-danger' : 'text-soft'}`}
    role={phase === 'failed' ? 'alert' : undefined}
  >
    {phase === 'failed' ? copy_text(copy.portfolio_page)('failed') : empty}
  </p>
)

/** The game account's listings with their delist and its sales with the proceeds to collect, across the page. */
const ForSale = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const locale = useSiteStore((state) => state.locale)
  const text = copy_text(copy.marketplace_page)
  return (
    <div className="aui-market-port grid min-w-0 gap-4">
      <OwnListings text={text} />
      <HistoryPanel locale={locale} text={text} />
    </div>
  )
}

/** The hero's move: the game account sends it to a verified bot, the bot account recalls it. */
const useHeroMove = (copy: AppCopy, on_bot: boolean) => {
  const paired = useSiteStore(({ session }) => !!bot_pairing(session))
  const recall = useCharacterRecall(copy)
  const text = copy_text(copy.portfolio_page)
  const move = (hero: Readonly<CharacterRow>): HeroMove | null => {
    // A hero in a fight is held by the fight: neither account can move it until the fight ends.
    const idle = hero.custody === 'kiosk'
    if (on_bot)
      return { label: text('recall_to_player'), run: () => recall.recall(hero.id), disabled: recall.busy || !idle }
    if (!paired) return null
    return { label: text('send_to_bot'), run: () => send_character_to_agent(hero.id, copy), disabled: !idle }
  }
  return { move, bot_heroes: recall.agent.characters, funding: recall.funding }
}

/** The wallet column: the one wallet card, then, for the game account, its door for assets of another wallet. */
const WalletColumn = ({
  copy,
  shown,
  choose,
}: Readonly<{ copy: AppCopy; shown: WalletShown; choose: (shown: WalletShown) => void }>) => {
  const session = useSiteStore((state) => state.session)
  return (
    <aside className="flex min-w-0 flex-col items-start gap-4">
      <div className="aui-panel self-stretch p-4">
        <WalletCard
          copy={copy}
          session={session}
          disconnect={() => dispatch_app({ type: 'auth/disconnected' })}
          embedded
          shown={{ value: shown, change: choose }}
        />
      </div>
      {shown === 'game' && (
        <Button
          disabled={session.wallet?.identity !== 'zklogin'}
          onClick={() => dispatch_app({ type: 'wallet_import/open' })}
        >
          <Download size={16} aria-hidden="true" />
          {copy_text(copy.settings_page)('import_title')}
        </Button>
      )}
    </aside>
  )
}

/** The page of a signed-in account: the wallet column, then the heroes, the bag and the listings it shows. */
const PortfolioAccount = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const session = useSiteStore((state) => state.session)
  const [chosen, choose] = useState<WalletShown>('game')
  const [tab, set_tab] = useState<Tab>('heroes')
  const shown = shown_wallet(session, chosen)
  const on_bot = shown === 'bot'
  const kiosk = useAgentKiosk(copy, false)
  const sale = useMarketSell()
  const heroes = useHeroMove(copy, on_bot)
  const account = useSiteStore(useShallow((state) => bag_account(state, on_bot)))
  const items = useMemo(() => bag_items(account), [account])
  const cells = useMemo(() => bag_cells(account), [account])
  const phase = account_phase(session, on_bot)
  const shown_heroes = on_bot ? heroes.bot_heroes : session.characters
  const sellable = new Set(sale.characters.map(({ id }) => id))
  const text = copy_text(copy.portfolio_page)
  // A tab's count shows once the account answered; its cell holds its width until then.
  const count = (rows: readonly unknown[]) => (phase === 'ready' ? rows.length : null)
  // What a tab shows before it has content: its boxes while the account loads, else a sentence.
  const empty = (tab: keyof typeof WAITING, sentence: string) =>
    phase === 'loading' ? WAITING[tab]() : <AccountNote copy={copy} phase={phase} empty={sentence} />
  const panels: Readonly<Record<Tab, () => ReactNode>> = {
    heroes: () =>
      shown_heroes.length ? (
        <div className={HEROES}>
          {shown_heroes.map((hero) => (
            <HeroCard
              key={hero.id}
              copy={copy}
              hero={hero}
              move={heroes.move(hero)}
              sell={!on_bot && sellable.has(hero.id) ? () => sale.choose({ kind: 'character', row: hero }) : null}
            />
          ))}
        </div>
      ) : (
        empty('heroes', text('heroes_empty'))
      ),
    bag: () => (
      <Bag
        copy={copy}
        cells={phase === 'ready' ? cells : null}
        items={items}
        on_bot={on_bot}
        kiosk={kiosk}
        sale={sale}
        waiting={empty('bag', text('bag_empty'))}
      />
    ),
    for_sale: () => (on_bot ? <p className={`${NOTE} text-soft`}>{text('bot_sells')}</p> : <ForSale copy={copy} />),
  }
  return (
    <div
      className="grid grid-cols-[340px_minmax(0,1fr)] items-start gap-6 text-text max-[900px]:grid-cols-1 [&_.aui-button]:min-h-11 [&_.aui-button]:gap-2 [&_.aui-button]:no-underline"
      data-portfolio-account={shown}
    >
      <WalletColumn copy={copy} shown={shown} choose={choose} />
      <section className="flex min-w-0 flex-col gap-4 [&_.aui-segments_.aui-button]:flex-[0_1_auto] [&_.aui-segments_.aui-button]:whitespace-nowrap">
        {/* The tabs, and at the row's end the agent's control: its state, and the way to its setup or its dialog. When
            the row cannot hold both, the control takes the next line, still at the right. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 [&>.aui-segments]:w-fit [&>.aui-segments]:max-w-full [&>.aui-segments]:flex-wrap">
          <SegmentedControl<Tab>
            label={text('tabs_label')}
            value={tab}
            on_change={set_tab}
            options={[
              { value: 'heroes', label: text('tab_heroes'), count: count(shown_heroes) },
              { value: 'bag', label: text('tab_bag'), count: count(cells) },
              { value: 'for_sale', label: text('tab_for_sale') },
            ]}
          />
          <div className="ml-auto" data-portfolio-agent="">
            <AgentSetupButton copy={copy} label={copy.ui.agent_setup} face="status" />
          </div>
        </div>
        {panels[tab]()}
      </section>
      {sale.selected && (
        <ItemDetailContext.Provider value="summary">
          <SaleDialog
            sale={sale}
            selected={sale.selected}
            text={copy_text(copy.marketplace_page)}
            close={() => sale.set_selected_key(null)}
          />
        </ItemDetailContext.Provider>
      )}
      {heroes.funding}
      <AgentTransferFunding
        wallet={kiosk.wallet}
        sender={kiosk.funding_sender}
        pairing={kiosk.pairing}
        copy={copy}
        close={kiosk.dismiss_funding}
      />
    </div>
  )
}

/** The portfolio page. It is about the account, so a visitor reads what it holds and signs in from the page. */
const PortfolioPage = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const staged = useSignInStage()
  const text = copy_text(copy.portfolio_page)
  if (!staged) return <PortfolioAccount copy={copy} />
  return (
    <SignInStage
      copy={copy}
      title={text('signin_title')}
      body={text('signin_body')}
      facts={[
        { icon: Shield, title: text('tab_heroes'), body: text('stage_heroes') },
        { icon: Backpack, title: text('tab_bag'), body: text('stage_bag') },
        { icon: Tag, title: text('tab_for_sale'), body: text('stage_for_sale') },
      ]}
    />
  )
}
export default PortfolioPage
