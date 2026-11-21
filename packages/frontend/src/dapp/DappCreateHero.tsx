// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { lazy, Suspense, useState } from 'react'
import { class_names } from '@aresrpg/immutable'
import { CHARACTER_PRICE_MIST } from '@aresrpg/sdk/character-price'
import { GAS_BUDGET_MIST } from '@aresrpg/sdk/gas-budget'
import { Button, NativeModal } from '@aresrpg/ui'

import { character_creation_insufficient } from '../character_creation_funding.ts'
import { character_icon } from '../content/assets.ts'
import type { CharacterRenderSource } from '../game/character_entities.ts'
import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { format_sui } from '../wallet_amount.ts'

import type { DappAccount } from './account.ts'
import { bot_wait_key, dapp_text } from './copy.ts'
import { direct_open } from './direct.ts'
import { bot_unreachable, direct_free, type DappState } from './state.ts'

import './dapp_home.css'

/** The game's own creation form. It loads when the player opens it, never with the page. */
const CharacterCreateModal = lazy(async () => {
  const { CharacterCreateModal: form } = await import('../components/CharacterCreateModal.tsx')
  return { default: form }
})

/** Why a hero cannot be created right now, most pressing first. */
export type CreateBlocker = 'creating' | 'unreachable' | 'waiting' | 'funds'
/**
 * A creation is one direct request of the bot wallet, which pays it: the bot must be free to take one,
 * and its wallet must hold the price and the fee, by the same rule the bot applies. A balance that is
 * not read yet blocks nothing: the bot refuses a creation it cannot pay.
 */
export const create_blocker = (dapp: DappState, account: DappAccount): CreateBlocker | null => {
  if (dapp.direct?.action === 'create_character' && direct_open(dapp.direct)) return 'creating'
  if (bot_unreachable(dapp)) return 'unreachable'
  if (!direct_free(dapp)) return 'waiting'
  return character_creation_insufficient(account.sui_balance_mist) ? 'funds' : null
}
/** The name the player typed for the hero being created. */
const creating_name = ({ direct }: DappState): string =>
  typeof direct?.payload.name === 'string' ? direct.payload.name : ''

/** The hero being made, as its 2D portrait in the chosen colours. This page mounts no canvas. */
const CreationPortrait = ({ source: { classe, male, colors } }: Readonly<{ source: CharacterRenderSource }>) => {
  const [color_1 = 0, color_2 = 0, color_3 = 0] = colors.map((color) => Number.parseInt(color.slice(1), 16))
  const portrait = character_icon(classe, male ? 'male' : 'female', { color_1, color_2, color_3 })
  return portrait && <img className="dapp-portrait dapp-create-portrait" src={portrait} alt="" />
}

/** The spells of a class open beside the form, so what the player typed stays. */
const open_class_spells = (classe: string): void => {
  globalThis.open(`/encyclopedia/classes/${encodeURIComponent(classe)}`, '_blank', 'noopener,noreferrer')
}

/** What a hero costs and who pays it: one sentence, on the tile and at the top of the form. */
const price_line = (copy: AppCopy, locale: Locale): string =>
  dapp_text(copy, 'add_hero_body', {
    count: String(class_names.length),
    price: format_sui(CHARACTER_PRICE_MIST, 0, locale),
  })

/**
 * The game's creation form, in this page's words: the bot wallet pays, and the hero is not played from
 * here. Its answer is not awaited: the request is followed like every direct request, by the notices.
 */
export const DappCreateSheet = ({
  copy,
  locale,
  close,
}: Readonly<{ copy: AppCopy; locale: Locale; close: () => void }>) => {
  const words: AppCopy = {
    ...copy,
    // The first line of the sheet: what a hero costs and who pays, before any choice is made.
    create_lead: price_line(copy, locale),
    create_and_play: dapp_text(copy, 'add_hero_action'),
  }
  return (
    <NativeModal close={close} label={copy.create_title} className="aui-modal-scrim">
      <Suspense
        fallback={
          <p className="dapp-loading" role="status" aria-busy="true">
            <span className="aui-spinner" aria-hidden="true" />
            {dapp_text(copy, 'loading')}
          </p>
        }
      >
        <CharacterCreateModal
          copy={words}
          cancel={close}
          create={(payload) => {
            dispatch_app({ type: 'dapp/create_hero', id: crypto.randomUUID(), payload })
            close()
            return Promise.resolve()
          }}
          insufficient={false}
          preview={(source) => <CreationPortrait source={source} />}
          view_spells={open_class_spells}
        />
      </Suspense>
    </NativeModal>
  )
}

type Tone = 'primary' | 'neutral'
/** The blockers the player must act on; the others pass by themselves. */
const ALERTS: readonly CreateBlocker[] = ['unreachable', 'funds']
/** The open form is this button's own: it exists only while a hero can be created. */
const CreateButton = ({ copy, locale, tone }: Readonly<{ copy: AppCopy; locale: Locale; tone: Tone }>) => {
  const [open, set_open] = useState(false)
  return (
    <>
      <Button tone={tone} onClick={() => set_open(true)}>
        {dapp_text(copy, 'add_hero_action')}
      </Button>
      {open && <DappCreateSheet copy={copy} locale={locale} close={() => set_open(false)} />}
    </>
  )
}
/** A hero cannot be created now: the button is closed and one sentence says why. */
const Blocked = ({
  copy,
  tone,
  blocker,
  reason,
}: Readonly<{ copy: AppCopy; tone: Tone; blocker: CreateBlocker; reason: string }>) => (
  <>
    <Button tone={tone} busy={blocker === 'creating'} disabled>
      {dapp_text(copy, 'add_hero_action')}
    </Button>
    <p className="dapp-run-line" data-tone={ALERTS.includes(blocker) ? 'alert' : undefined} role="status">
      {reason}
    </p>
  </>
)

/**
 * The way to a new hero: what it costs, who pays, and one button. While a hero cannot be created the
 * button is closed and one sentence says why; a form left open closes with it.
 */
export const DappCreateHero = ({
  copy,
  locale,
  primary = false,
}: Readonly<{ copy: AppCopy; locale: Locale; primary?: boolean }>) => {
  const blocker = useAppStore(({ dapp, session }) => create_blocker(dapp, session.agent_inventory))
  const name = useAppStore(({ dapp }) => creating_name(dapp))
  const tone = primary ? 'primary' : 'neutral'
  const price = format_sui(CHARACTER_PRICE_MIST, 0, locale)
  const reasons: Readonly<Record<CreateBlocker, string>> = {
    creating: dapp_text(copy, 'create_sent', { name }),
    unreachable: dapp_text(copy, bot_wait_key(true)),
    waiting: dapp_text(copy, bot_wait_key(false)),
    funds: dapp_text(copy, 'add_hero_funds', { price, fee: format_sui(GAS_BUDGET_MIST, 2, locale) }),
  }
  return (
    <div className="dapp-create" data-create={blocker ?? 'ready'}>
      <p className="dapp-note">{price_line(copy, locale)}</p>
      {blocker ? (
        <Blocked copy={copy} tone={tone} blocker={blocker} reason={reasons[blocker]} />
      ) : (
        <CreateButton copy={copy} locale={locale} tone={tone} />
      )}
    </div>
  )
}
