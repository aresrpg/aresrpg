// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The component catalogue: every export of this package with local fixture props. It reads no game state.
// The mobile preview is the same page in an iframe at 932 × 430, so media and container queries are real.

import { useState, type ReactNode } from 'react'

import { level_emblem, slot_art, stat_art } from '../art.ts'
import { CarvedIcon, type CarvedSymbol } from '../components/CarvedIcon.tsx'
import { Collection } from '../components/Collection.tsx'
import {
  Button,
  Field,
  IconButton,
  KeyHint,
  NavigationRow,
  SegmentedControl,
  Select,
  Slider,
  Toggle,
} from '../components/controls.tsx'
import { DragScroll } from '../components/DragScroll.tsx'
import { FilterMenu } from '../components/FilterMenu.tsx'
import { FloatingWindow } from '../components/FloatingWindow.tsx'
import { Ground } from '../components/Ground.tsx'
import { SuiLogo } from '../components/SuiLogo.tsx'
import { ConfirmDialog, GameWindow, Panel } from '../components/surfaces.tsx'
import { ValueBadge } from '../components/workspaces.tsx'
import { CombatHud, MobDetails, ProgressBar, ProgressionCard } from '../prebuilt/game.tsx'
import { InventoryCell } from '../prebuilt/InventoryCell.tsx'
import { ItemSheet } from '../prebuilt/ItemSheet.tsx'
import { MapView, MinimapView } from '../prebuilt/maps.tsx'
import { MarketHistory } from '../prebuilt/MarketHistory.tsx'
import {
  MarketCapitalization,
  MarketCurrency,
  MarketEmpty,
  MarketListingIcon,
  MarketVolume,
} from '../prebuilt/MarketParts.tsx'
import { SettingRow, SettingsView, LanguageView } from '../prebuilt/account.tsx'
import { SpellRow } from '../prebuilt/SpellRow.tsx'
import { StakingRewards, StakingWalletRow } from '../prebuilt/StakingRewards.tsx'
import { Vitals } from '../prebuilt/Vitals.tsx'
import { WalletTransfer, WalletView } from '../prebuilt/Wallet.tsx'
import './workshop.css'

const noop = (): void => undefined
const image = (src: string | undefined) => <img src={src} alt="" />
const Glyph = ({ size = 16, className }: Readonly<{ size?: number; className?: string }>) => (
  <svg aria-hidden="true" className={className} width={size} height={size} viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)
const header = { title: 'Workspace', icon: <CarvedIcon name="settings" />, close: noop, close_label: 'Close' }
const MAP = <div className="aui-workshop-map" />
const CARVED =
  'inventory stats spells jobs runeforge map fullscreen characters mastery kares airdrop kolizeum settings admin'.split(
    ' '
  ) as readonly CarvedSymbol[]
const TOKENS =
  'void bg sunk surface raised lifted high peak steel faint muted soft ink brass-lo brass brass-hi orange blue danger success sui'.split(
    ' '
  )

const Tokens = () => (
  <div className="aui-workshop-swatches">
    {TOKENS.map((token) => (
      <span key={token} style={{ background: `var(--aui-${token})` }}>
        --aui-{token}
      </span>
    ))}
  </div>
)

const Buttons = () => {
  const [busy, set_busy] = useState(false)
  return (
    <Panel className="aui-workshop-row">
      <Button tone="primary">Primary</Button>
      <Button>Neutral</Button>
      <Button tone="danger">Danger</Button>
      <Button disabled>Disabled</Button>
      <Button busy={busy} onClick={() => set_busy(!busy)}>
        Busy
      </Button>
      <IconButton label="Inventory" icon={<CarvedIcon name="inventory" />} hotkey="E" />
      <KeyHint>F</KeyHint>
    </Panel>
  )
}

const Navigation = () => {
  const [value, set_value] = useState('stats')
  return (
    <Panel className="aui-workshop-stack">
      <SegmentedControl
        label="Tabs"
        value={value}
        on_change={set_value}
        options={['stats', 'spells', 'jobs'].map((id) => ({
          value: id,
          label: id,
          icon: <CarvedIcon name={id as CarvedSymbol} />,
        }))}
      />
      {['stats', 'spells', 'jobs'].map((id) => (
        <NavigationRow key={id} selected={value === id} onClick={() => set_value(id)}>
          {id}
        </NavigationRow>
      ))}
    </Panel>
  )
}

const Fields = () => {
  const [quality, set_quality] = useState('high')
  const [volume, set_volume] = useState(65)
  const [motion, set_motion] = useState(true)
  const [search, set_search] = useState('')
  return (
    <Panel className="aui-workshop-stack">
      <Select
        label="Quality"
        value={quality}
        onChange={(event) => set_quality(event.target.value)}
        options={['low', 'medium', 'high'].map((value) => ({ value, label: value }))}
      />
      <Slider label="Volume" value={volume} on_change={set_volume} />
      <Toggle label="Motion" checked={motion} on_change={set_motion} />
      <Toggle label="Disabled" checked={false} disabled on_change={noop} />
      <Field label="Search" error={search.length > 8 ? 'Too long' : undefined}>
        <input
          className="aui-input"
          type="search"
          value={search}
          onChange={(event) => set_search(event.target.value)}
        />
      </Field>
    </Panel>
  )
}

const Surfaces = () => (
  <div className="aui-workshop-stack">
    <Panel>
      <ValueBadge label="Kamas" value="12 400" icon={<SuiLogo />} />
    </Panel>
    <GameWindow title="Game window" icon={<CarvedIcon name="map" />} hotkey="M" close={noop} close_label="Close">
      <p className="aui-workshop-copy">Window content.</p>
    </GameWindow>
  </div>
)

const Dialogs = () => {
  const [open, set_open] = useState<'confirm' | 'danger' | 'floating' | null>(null)
  const close = () => set_open(null)
  return (
    <Panel className="aui-workshop-row">
      <Button onClick={() => set_open('confirm')}>ConfirmDialog</Button>
      <Button tone="danger" onClick={() => set_open('danger')}>
        Danger
      </Button>
      <Button onClick={() => set_open('floating')}>FloatingWindow</Button>
      {(open === 'confirm' || open === 'danger') && (
        <ConfirmDialog
          title="Leave the game?"
          description="Your character stays where it is."
          confirm_label="Leave"
          cancel_label="Stay"
          close_label="Close"
          danger={open === 'danger'}
          on_confirm={close}
          on_cancel={close}
          icon={<CarvedIcon name="settings" />}
        />
      )}
      {open === 'floating' && (
        <FloatingWindow label="Floating window" identity="workshop" close={close} blocking={false}>
          <GameWindow title="Floating window" close={close} close_label="Close">
            <p className="aui-workshop-copy">A window that keeps the page usable.</p>
          </GameWindow>
        </FloatingWindow>
      )}
    </Panel>
  )
}

/** The page ground in a fixed box: the box contains its fixed layers, and the ground pauses while the box is off screen. */
const GroundPreview = () => (
  <div className="aui-workshop-ground">
    <Ground />
  </div>
)

const ENTRIES_ART = Object.entries(slot_art).slice(0, 11)
const Collections = () => {
  const [selected, set_selected] = useState<string | null>('weapon')
  const [filter, set_filter] = useState<string | null>(null)
  const entries = ENTRIES_ART.map(([id, art]) => ({
    id,
    label: id,
    image: art,
    meta: 'Level 20',
    badge: id === 'ring' ? '2' : undefined,
  }))
  return (
    <div className="aui-workshop-stack">
      <FilterMenu
        title="Category"
        close_label="Close"
        value={filter}
        choose={set_filter}
        options={entries.map(({ id }) => ({ id, label: id, count: 3 }))}
      />
      <Collection label="Tiles" entries={entries} selected={selected} select={set_selected} />
      <Collection label="Rows" variant="rows" entries={entries.slice(0, 4)} selected={selected} select={set_selected} />
    </div>
  )
}

const Icons = () => (
  <Panel className="aui-workshop-stack">
    <div className="aui-workshop-row">
      {CARVED.map((name) => (
        <CarvedIcon key={name} name={name} />
      ))}
    </div>
    <div className="aui-workshop-row">
      <SuiLogo size={14} />
      <SuiLogo size={24} />
      <SuiLogo size={40} />
    </div>
  </Panel>
)

const Scroll = () => (
  <DragScroll className="aui-workshop-row aui-workshop-scroll">
    {Object.entries(slot_art).map(([id, art]) => (
      <InventoryCell key={id} id={id} label={id} icon={art} fallback={id[0]!} amount={3} level={12} />
    ))}
  </DragScroll>
)

const Combat = () => {
  const [remaining, set_remaining] = useState(32)
  return (
    <CombatHud
      label="Fight"
      vitals={
        <Vitals
          health="1040"
          fill={0.72}
          health_label="Health"
          on_health={noop}
          ap="6"
          mp="3"
          ap_label="AP"
          mp_label="MP"
        />
      }
      spells={Array.from({ length: 8 }, (_, index) => (
        <Button key={index}>{index + 1}</Button>
      ))}
      timer={{ label: 'End turn', remaining, duration: 45 }}
      controls={
        <Button tone="primary" disabled={remaining === 0} onClick={() => set_remaining(0)}>
          End turn
        </Button>
      }
    />
  )
}

const STAT = (id: string, value: string) => ({
  id,
  label: id,
  value,
  icon: image(stat_art[id as keyof typeof stat_art]),
})
const Mob = () => (
  <div className="aui-workshop-stack">
    <MobDetails
      title="Moka"
      subtitle="Level 12"
      portrait={image(slot_art.pet)}
      vitals={[STAT('health', '340'), STAT('action', '6'), STAT('movement', '3')]}
      resistances={[STAT('strength', '10%'), STAT('intelligence', '−5%'), STAT('agility', '0%')]}
      actions={<Button tone="primary">Fight</Button>}
    />
    <ProgressBar label="Experience" value={640} max={1000} detail="64%" />
  </div>
)

const Progression = () => (
  <ProgressionCard
    title="Level up"
    subtitle="Senshi reached level 100"
    rewards_label="Rewards"
    icon={image(level_emblem)}
    progress={<strong>100</strong>}
    rewards={
      <>
        <ValueBadge label="Characteristic points" value="+5" />
        <ValueBadge label="Spell points" value="+1" />
      </>
    }
    action={<Button tone="primary">Allocate</Button>}
    close={noop}
    close_label="Close"
  />
)

const Wallet = () => {
  const [wallet, set_wallet] = useState<'game' | 'bot'>('game')
  const leg = (name: string) => ({ name, icon: <SuiLogo />, balance: { value: '12.5', unit: 'SUI' } })
  return (
    <div className="aui-workshop-stack">
      <WalletView
        wallets={{
          label: 'Wallet',
          value: wallet,
          on_change: set_wallet,
          options: [
            { value: 'game', label: 'Game' },
            { value: 'bot', label: 'Bot' },
          ],
        }}
        signer="Google"
        address="0x7a3f…91c2"
        main={{ value: '12.5', unit: 'SUI' }}
        main_icon={<SuiLogo size={30} />}
        second={{ value: '480', unit: 'KARES' }}
        actions={<Button tone="primary">Add funds</Button>}
      />
      <WalletTransfer from_label="From" to_label="To" from={leg('Game')} to={leg('Bot')} swap_label="Swap" swap={noop}>
        <Button tone="primary">Send</Button>
      </WalletTransfer>
    </div>
  )
}

const Staking = () => (
  <div className="aui-workshop-stack">
    <StakingWalletRow
      icon={<SuiLogo />}
      name="Game wallet"
      selected
      figures={[
        { value: '1 200', label: 'Staked' },
        { value: '3.2', label: 'Daily', hue: 'sky' },
      ]}
    />
    <StakingWalletRow
      icon={<SuiLogo />}
      name="Bot wallet"
      selected={false}
      on_select={noop}
      figures={null}
      status="Loading"
    />
    <StakingRewards
      icon={<SuiLogo size={24} />}
      stake_label="Staked"
      stake="1 200"
      unit="KARES"
      accrued_label="Accrued"
      lanes={[
        { asset: 'SUI', hue: 'sky', icon: <SuiLogo />, accrued: '0.412' },
        { asset: 'KARES', hue: 'gold', accrued: '18.20' },
      ]}
      action={<Button tone="primary">Claim</Button>}
    />
  </div>
)

const Items = () => (
  <div className="aui-workshop-stack">
    <SpellRow color="#e8b44f" icon={null} name="Pressure" subline="3 AP · range 1–4" right={<KeyHint>1</KeyHint>} />
    <div className="aui-workshop-sheet">
      <ItemSheet
        icon={slot_art.weapon ?? null}
        name="Bronze sword"
        level_label="Level 20"
        category={{ label: 'Weapon', color: '#c9a36a' }}
        description="A plain blade."
        labels={{ characteristics: 'Characteristics', damages: 'Hits', range_to: 'to' }}
        damages={[{ from: 8, to: 14, color: '#d36b4a', element: 'Strength' }]}
        stats={[
          { key: 'strength', label: 'Strength', minimum: 10, maximum: 20, delta: 4 },
          { key: 'vitality', label: 'Vitality', minimum: 30, maximum: 40 },
          { key: 'earth_resistance', label: 'Earth resistance', minimum: -5, maximum: -2 },
        ]}
      />
    </div>
  </div>
)

const Maps = () => (
  <div className="aui-workshop-stack">
    <MinimapView map={MAP} title="Primal Woods" coordinates="12, −4" open_label="Open map" open={noop} />
    <MapView
      header={{ ...header, title: 'Map' }}
      map={MAP}
      world="Primal Woods"
      coordinates="12, −4"
      legend={<span>Legend</span>}
      zoom_in={noop}
      zoom_out={noop}
      labels={{ zoom_in: 'Zoom in', zoom_out: 'Zoom out' }}
    />
  </div>
)

const Settings = () => {
  const [section, set_section] = useState('display')
  const [language, set_language] = useState('en')
  return section === 'language' ? (
    <LanguageView
      header={{ ...header, title: 'Language', close: () => set_section('display') }}
      value={language}
      choose={set_language}
      languages={[
        { value: 'en', label: 'English' },
        { value: 'fr', label: 'Français' },
        { value: 'ja', label: '日本語', badge: 'Beta' },
      ]}
    />
  ) : (
    <SettingsView
      header={{ ...header, title: 'Settings' }}
      selected={section}
      select={set_section}
      sections={[
        { id: 'display', label: 'Display', icon: <CarvedIcon name="settings" /> },
        { id: 'language', label: 'Language', detail: 'English' },
      ]}
    >
      <SettingRow title="Motion" description="Animate windows">
        <Toggle label="Motion" checked on_change={noop} />
      </SettingRow>
    </SettingsView>
  )
}

const Market = () => (
  <div className="aui-workshop-stack">
    <Panel className="aui-workshop-row">
      <MarketListingIcon art={{ icon: slot_art.ring ?? null }} />
      <MarketListingIcon art={{ icon: null, fallback: 'R' }} />
      <span>
        12.5 <MarketCurrency />
      </span>
      <MarketVolume window="24h" title="Volume" partial={false} label="24h volume" value="1 240" />
      <MarketCapitalization
        labels={{ total_units: 'Units', market_cap: 'Market cap', market_cap_basis: 'Floor × units' }}
        units="3 200"
        capitalization="18 400"
      />
    </Panel>
    <MarketEmpty text="No listing" Icon={Glyph} />
    <MarketHistory
      Icons={{ profits: Glyph, empty: Glyph }}
      revenue="320"
      profits={{ value: '12.5', pending: false, collect: noop }}
      load_more={null}
      sales={[
        {
          key: '1',
          icon: slot_art.ring ?? null,
          name: 'Ring',
          suffix: '×10',
          date: '2026-11-20',
          price: '4.2',
          buyer: '0x91…c2',
        },
        {
          key: '2',
          icon: slot_art.hat ?? null,
          name: 'Hat',
          suffix: '',
          date: '2026-11-19',
          price: '1.1',
          buyer: '0x4a…07',
        },
      ]}
      labels={{
        revenue_30d: 'Revenue, 30 days',
        sales_count: 'Sales',
        unclaimed: 'Unclaimed',
        collect: 'Collect',
        no_history: 'No sale yet',
        item: 'Item',
        date: 'Date',
        price: 'Price',
        buyer: 'Buyer',
        load_more: 'Load more',
      }}
    />
  </div>
)

const ENTRIES = {
  components: {
    Tokens,
    Buttons,
    Navigation,
    Fields,
    Surfaces,
    Dialogs,
    Collections,
    Icons,
    Scroll,
    Ground: GroundPreview,
  },
  prebuilt: { Combat, Mob, Progression, Wallet, Staking, Items, Maps, Settings, Market },
} as const
type Group = keyof typeof ENTRIES
const EXAMPLES: Readonly<Record<string, () => ReactNode>> = { ...ENTRIES.components, ...ENTRIES.prebuilt }
const first_entry = (): string => {
  const [, requested = ''] = globalThis.location.hash.slice(1).split('/')
  return requested in EXAMPLES ? requested : 'Buttons'
}

export const Workshop = () => {
  const [entry, set_entry] = useState(first_entry)
  const [viewport, set_viewport] = useState<'desktop' | 'mobile'>('desktop')
  const Example = EXAMPLES[entry]!
  if (globalThis.self !== globalThis.top) {
    return (
      <div className="aui-workshop-embedded">
        <Example />
      </div>
    )
  }
  return (
    <section className="aui-workshop">
      <header className="aui-workshop-heading">
        <h1>Design workshop</h1>
        <SegmentedControl
          label="Preview size"
          value={viewport}
          on_change={set_viewport}
          options={[
            { value: 'desktop', label: 'Desktop' },
            { value: 'mobile', label: 'Mobile · 932 × 430' },
          ]}
        />
      </header>
      <nav className="aui-workshop-navigation">
        {(Object.keys(ENTRIES) as Group[]).map((group) => (
          <div key={group}>
            <h2>{group}</h2>
            {Object.keys(ENTRIES[group]).map((id) => (
              <NavigationRow key={id} selected={entry === id} onClick={() => set_entry(id)}>
                {id}
              </NavigationRow>
            ))}
          </div>
        ))}
      </nav>
      <div className="aui-workshop-preview" data-workshop-view={entry}>
        {viewport === 'mobile' ? (
          <iframe
            key={entry}
            className="aui-workshop-device"
            title={`Mobile · ${entry}`}
            src={`${globalThis.location.pathname}${globalThis.location.search}#ui/${entry}`}
          />
        ) : (
          <Example />
        )}
      </div>
    </section>
  )
}
