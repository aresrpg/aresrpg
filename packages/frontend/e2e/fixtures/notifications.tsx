// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Visual review fixtures only. No wallet, live feed, or Discord transport is started.
import { roll_quality } from '@aresrpg/immutable'
import { useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, CarvedIcon, NotificationCard } from '@aresrpg/ui'

import items from '../../../../seed/content/items.json'
import mobs from '../../../../seed/content/mobs.json'
import { item_icon, mob_icon } from '../../src/content/assets.ts'
import { SuiLogo } from '../../src/components/SuiLogo.tsx'
import { StatLine } from '../../src/components/ItemDetailBody.tsx'
import '../../src/tailwind.css'
import './notifications.css'

type Kind = 'market' | 'gather' | 'victory' | 'loot'
const TYPES: readonly Readonly<{ id: Kind; label: string; rule: string }>[] = [
  {
    id: 'market',
    label: 'Marketplace',
    rule: 'A completed public sale. Quantity and total price stay front and center.',
  },
  { id: 'gather', label: 'Rare gathering', rule: 'A rare gathering drop. One discovery, one card.' },
  {
    id: 'victory',
    label: 'Dungeon victory',
    rule: 'One celebration for the winning party, after the dungeon boss is defeated.',
  },
  {
    id: 'loot',
    label: 'Exceptional loot',
    rule: 'Fight gear with average roll quality strictly above 90%. Fixed stats do not affect the average.',
  },
]
const seed_item = (id: string) => items.find(({ item_type }) => item_type === id)!
const branch = seed_item('gnawed_branch')
const wheat = seed_item('golden_wheat')
const hood = seed_item('lorito_hat__golden')
const boss = mobs.find(({ mob_type }) => mob_type === 'golden_lorito')!
const STATS = [
  { key: 'vitality', value: 49 },
  { key: 'intelligence', value: 48 },
  { key: 'critical', value: 2 },
] as const
const stats = STATS
const quality =
  roll_quality(hood.stats!, Object.fromEntries(stats.map(({ key, value }) => [key, value])))!.basis_points / 100
const player = (names: boolean, name: string, address: string) => (names ? name : address)
const Card = ({ kind, names }: Readonly<{ kind: Kind; names: boolean }>) => {
  const seller = player(names, 'sceat.sui', '0x7a2f…91c4')
  const finder = player(names, 'math09.sui', '0x3c91…d8e2')
  switch (kind) {
    case 'market':
      return (
        <NotificationCard
          type="Marketplace sale"
          tone="gold"
          title={`10× ${branch.name}`}
          subtitle={`Sold by ${seller}`}
          image={item_icon(branch.item_type)!}
          summary={
            <span className="aui-notification__amount" aria-label="2.5 SUI">
              <SuiLogo size={18} />
              <span>2.5</span>
              <small>SUI</small>
            </span>
          }
        />
      )
    case 'gather':
      return (
        <NotificationCard
          type="Rare gathering"
          tone="blue"
          title={wheat.name}
          subtitle={`Found by ${finder}`}
          image={item_icon(wheat.item_type)!}
          summary="×1"
        />
      )
    case 'victory':
      return (
        <NotificationCard
          type="Dungeon victory"
          tone="gold"
          title={boss.name}
          subtitle="Gilded Lorito · Final boss defeated"
          image={mob_icon(boss.mob_type)!}
        >
          <p className="aui-notification__party">
            {['sceat.sui', 'math09.sui', 'mira.sui', 'kael.sui']
              .map((name, index) =>
                player(names, name, `0x${['7a2f…91c4', '3c91…d8e2', '5b04…a237', '9e61…f803'][index]}`)
              )
              .join(' · ')}
          </p>
        </NotificationCard>
      )
    case 'loot':
      return (
        <NotificationCard
          type="Exceptional loot"
          tone="blue"
          title={hood.name}
          subtitle={`Hat · Level ${hood.level}`}
          image={item_icon(hood.item_type)!}
          summary={`${quality.toFixed(1)}%`}
        >
          <div data-active-item-stats="">
            {stats.map((stat) => (
              <StatLine
                key={stat.key}
                row={{ key: stat.key, minimum: stat.value, maximum: stat.value }}
                labels={{ characteristics: 'Characteristics', damages: 'Damage', level_short: 'Lv.', range_to: 'to' }}
              />
            ))}
          </div>
        </NotificationCard>
      )
  }
}
const DiscordMessage = ({ children, kind, names }: Readonly<{ children: ReactNode; kind: Kind; names: boolean }>) => {
  const name = player(names, 'math09.sui', '0x3c91…d8e2')
  const messages: Record<Kind, ReactNode> = {
    market: (
      <>
        <strong>{player(names, 'sceat.sui', '0x7a2f…91c4')}</strong> just sold <strong>10× {branch.name}</strong> for{' '}
        <strong>2.5 SUI</strong>.
      </>
    ),
    gather: (
      <>
        <strong>{name}</strong> discovered <strong>{wheat.name}</strong> while gathering.
      </>
    ),
    victory: (
      <>
        <strong>{player(names, 'sceat.sui', '0x7a2f…91c4')}</strong> and their party defeated{' '}
        <strong>{boss.name}</strong>!
      </>
    ),
    loot: (
      <>
        <strong>{name}</strong> found a <strong>{quality.toFixed(1)}% roll</strong> on {hood.name}.
      </>
    ),
  }
  return (
    <div className="notification-discord">
      <div className="notification-discord__avatar">
        <CarvedIcon name="characters" />
      </div>
      <div className="notification-discord__body">
        <div className="notification-discord__author">
          AresRPG <span>APP</span>
          <small>Today at 17:00</small>
        </div>
        <p>{messages[kind]}</p>
        {children}
      </div>
    </div>
  )
}
const Gallery = () => {
  const [filter, set_filter] = useState<Kind | 'all'>('all')
  const [discord, set_discord] = useState(true)
  const [names, set_names] = useState(true)
  const [mobile, set_mobile] = useState(false)
  const visible = TYPES.filter(({ id }) => filter === 'all' || filter === id)
  return (
    <main
      className={`notification-gallery ${discord ? 'notification-gallery--discord' : ''} ${mobile ? 'notification-gallery--mobile' : ''}`}
    >
      <header className="notification-gallery__masthead">
        <a href="/e2e/fixtures/notifications.html" className="notification-gallery__wordmark">
          <CarvedIcon name="characters" />
          <span>
            AresRPG<small>COMMUNITY</small>
          </span>
        </a>
        <span className="notification-gallery__preview">
          Design preview <i /> Sample events
        </span>
      </header>
      <section className="notification-gallery__intro">
        <div>
          <span className="notification-gallery__eyebrow">CARD PREVIEW</span>
          <h1>Discord notifications</h1>
          <p>Compact cards, shown at their actual size.</p>
        </div>
        <div className="notification-gallery__destination">
          <span>#</span>
          <div>
            <strong>One community feed</strong>
            <small>Four types of moments · AresRPG bot</small>
          </div>
        </div>
      </section>
      <div className="notification-gallery__toolbar">
        <nav aria-label="Notification types">
          <Button aria-pressed={filter === 'all'} onClick={() => set_filter('all')}>
            All moments <span className="notification-gallery__count">4</span>
          </Button>
          {TYPES.map(({ id, label }) => (
            <Button key={id} aria-pressed={filter === id} onClick={() => set_filter(id)}>
              {label}
            </Button>
          ))}
        </nav>
        <div className="notification-gallery__options">
          <Button aria-pressed={discord} onClick={() => set_discord(!discord)}>
            {discord ? 'In Discord' : 'Cards only'}
          </Button>
          <Button aria-pressed={mobile} onClick={() => set_mobile(!mobile)}>
            Mobile width
          </Button>
          <label>
            <input type="checkbox" checked={names} onChange={(event) => set_names(event.target.checked)} /> SuiNS names
          </label>
        </div>
      </div>
      <section className="notification-gallery__grid" aria-label="Notification card previews">
        {visible.map(({ id, label, rule }) => (
          <div className="notification-gallery__example" key={id}>
            <header>
              <span>0{TYPES.findIndex((type) => type.id === id) + 1}</span>
              <h2>{label}</h2>
              <span>{id === 'loot' ? '> 90% average' : 'Confirmed event'}</span>
            </header>
            {discord ? (
              <DiscordMessage kind={id} names={names}>
                <Card kind={id} names={names} />
              </DiscordMessage>
            ) : (
              <Card kind={id} names={names} />
            )}
            <p>{rule}</p>
          </div>
        ))}
      </section>
      <footer className="notification-gallery__footer">
        <span>
          <CarvedIcon name="settings" /> Built with the AresRPG design system
        </span>
        <span>Illustrative events. Nothing is posted to Discord.</span>
      </footer>
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Gallery />)
