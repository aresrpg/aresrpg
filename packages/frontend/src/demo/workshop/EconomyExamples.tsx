// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { Button, ConfirmDialog, Workspace } from '@aresrpg/ui'
import { Gem, Gift } from 'lucide-react'
import type { MasteryRow } from '@aresrpg/protocol'
import { dungeon_content_id } from '@aresrpg/sdk/seed-ids'
import { resolve_pins } from '@aresrpg/sdk/pins'
import { KARES_UNIT } from '@aresrpg/sdk/kares-economics'

import { env } from '../../env.ts'
import { AirdropPageView } from '../../airdrop/AirdropPage.tsx'
import MasteryPage from '../../mastery/MasteryPage.tsx'
import { MasterySourceContext, type MasterySource } from '../../mastery/MasterySource.tsx'
import { initial_mastery_state } from '../../modules/mastery.ts'
import { adventure_character } from '../../adventure/character.ts'
import { adventure_character_row } from '../../adventure/projection.ts'
import { content_catalog } from '../../content/catalog.ts'
import { copy_text, type AppCopy } from '../../i18n/copy.ts'
import { rolled_item_types } from '../../modules/claims.ts'
import { mastery_reward } from '../../mastery/model.ts'

import { WorkshopSurface } from './shared.tsx'

const fixture_dungeon_id = (world: string) => {
  const slug = content_catalog.world(world)?.cities[0]?.dungeon
  const pins = resolve_pins(env.network) as { content_root?: { id: string }; seed_package_original?: string }
  return slug && pins.content_root && pins.seed_package_original
    ? dungeon_content_id(pins.content_root.id, pins.seed_package_original, slug)
    : ''
}

export const MasteryExample = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [review, set_review] = useState(false)
  const [row, set_row] = useState<MasteryRow>({
    id: 'preview',
    owner: 'preview',
    points: '60',
    last_completed_epoch: null,
    quest_epoch: '0',
    quest_started_ms: '0',
    quest_world: 'nauvis',
    quest_dungeon: '',
    quest_reward: 0,
    quest_completed: false,
  })
  const source: MasterySource = {
    mastery: {
      ...initial_mastery_state(),
      loaded: true,
      row,
      offers: content_catalog.mastery.offers.map((offer) => ({
        id: offer.item_type,
        item_type: offer.item_type,
        template: offer.item_type,
        cost: String(offer.cost),
        enabled: true,
      })),
    },
    characters: [{ ...adventure_character_row(adventure_character()), custody: 'kiosk' }],
    current_epoch: '1',
    connected: true,
    balance: 100n * KARES_UNIT,
    dispatch: (input) => {
      if (input.type === 'mastery/redeem') set_review(true)
      if (input.type === 'mastery/start')
        set_row({
          ...row,
          quest_epoch: '1',
          quest_world: input.world,
          quest_dungeon: fixture_dungeon_id(input.world),
          quest_reward: mastery_reward(content_catalog.world(input.world)?.entry_level ?? 1),
        })
    },
  }
  return (
    <WorkshopSurface copy={copy} title={copy.mastery} icon={<Gem />}>
      {(header) => (
        <>
          <Workspace {...header} className="aui-feature-port aui-mastery-port">
            <MasterySourceContext.Provider value={source}>
              <MasteryPage copy={copy} />
            </MasterySourceContext.Provider>
          </Workspace>
          {review && (
            <ConfirmDialog
              title={copy.mastery}
              description={copy.ui.preview_only}
              confirm_label={copy.wallet_close}
              cancel_label={copy.cancel}
              close_label={copy.wallet_close}
              on_cancel={() => set_review(false)}
              on_confirm={() => set_review(false)}
            />
          )}
        </>
      )}
    </WorkshopSurface>
  )
}

export const AirdropExample = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const text = copy_text(copy.airdrop_page)
  const [connected, connect] = useState(false)
  const [claimed, set_claimed] = useState(false)
  const [recovered, set_recovered] = useState(true)
  const cards = Array.from(rolled_item_types().keys())
    .slice(0, 2)
    .map((template, index) => ({ id: `voucher-${index}`, template, amount: index + 1 }))
  return (
    <WorkshopSurface copy={copy} title={text('title')} icon={<Gift />}>
      {(header) => (
        <Workspace {...header} className="aui-feature-port aui-airdrop-port">
          <AirdropPageView
            copy={copy}
            collection={{
              address: '0x…',
              cards: claimed ? [] : cards,
              busy: null,
              loaded: connected,
              connected,
              gift_ready: !recovered,
              error: null,
              wallet_control: (
                <Button onClick={() => connect(!connected)}>
                  {text(connected ? 'holder_connected' : 'holder_connect')}
                </Button>
              ),
              refresh: () => set_claimed(false),
              claim: () => set_claimed(true),
              recover: () => set_recovered(true),
            }}
          />
        </Workspace>
      )}
    </WorkshopSurface>
  )
}
