// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What every Start shares, on the Quest tab and on the Raid tab: the optional fee limit of one hero's
// run, the floor time of a walk, and the one potion a hero may drink instead of walking.
import { Button, Field } from '@aresrpg/ui'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'

import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { format_sui, parse_sui_amount } from '../wallet_amount.ts'

import { dapp_text } from './copy.ts'
import { direct_free, type DappInput } from './state.ts'

import './dapp_parts.css'

type FeeEntry = Readonly<{ valid: true; cap: string | null } | { valid: false }>
/**
 * What a fee limit typed in SUI means: nothing typed is no limit, an amount above zero is that many
 * MIST, and anything else is no answer at all. An entry that cannot be read never becomes "no limit".
 */
export const fee_entry = (typed: string): FeeEntry => {
  if (!typed.trim()) return { valid: true, cap: null }
  const mist = parse_sui_amount(typed)
  return mist === null ? { valid: false } : { valid: true, cap: String(mist) }
}
/** A limit in MIST as the SUI a player types: exact, without trailing zeros. */
export const fee_text = (cap: string | null): string =>
  cap === null ? '' : format_sui(BigInt(cap), 9).replace(/0+$/, '').replace(/\.$/, '')
/** Whether the limit on screen can be sent: what was typed, or the stored limit while nothing was. */
export const fee_valid = (typed: string | null, cap: string | null): boolean => fee_entry(typed ?? fee_text(cap)).valid

/**
 * The optional fee limit of one hero's run, in SUI. The text as typed is the caller's view state; only
 * a limit that can be read reaches `pick`, so the stored limit is always a valid one.
 */
export const DappFeeCap = ({
  copy,
  cap,
  typed,
  type,
  pick,
}: Readonly<{
  copy: AppCopy
  /** The stored limit, in MIST; null is no limit. */
  cap: string | null
  /** The field as typed; null until the player types, and the stored limit shows. */
  typed: string | null
  type: (typed: string) => void
  pick: (cap: string | null) => void
}>) => {
  const shown = typed ?? fee_text(cap)
  const entry = fee_entry(shown)
  const enter = (value: string): void => {
    type(value)
    const next = fee_entry(value)
    if (next.valid) pick(next.cap)
  }
  return (
    <div className="dapp-fee-cap" data-fee-cap={entry.valid ? 'valid' : 'invalid'}>
      <Field
        label={`${dapp_text(copy, 'fee_cap')} (SUI)`}
        error={entry.valid ? undefined : dapp_text(copy, 'fee_cap_invalid')}
      >
        <input
          className="aui-input"
          inputMode="decimal"
          autoComplete="off"
          placeholder={dapp_text(copy, 'fee_cap_none')}
          value={shown}
          aria-invalid={!entry.valid}
          onChange={(event) => enter(event.target.value)}
        />
      </Field>
      {entry.valid && entry.cap !== null && (
        <p className="dapp-note">{dapp_text(copy, 'fee_cap_hint', { amount: fee_text(entry.cap) })}</p>
      )}
    </div>
  )
}

/** A walking time is a floor, so it rounds down: seconds under a minute, else whole minutes. */
export const walk_time = (locale: Locale, seconds: number): string => {
  const [value, unit] = seconds < 60 ? [seconds, 'second'] : [Math.floor(seconds / 60), 'minute']
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' }).format(value)
}

type Hero = Readonly<Pick<CharacterRow, 'id'>>
type Potion = Readonly<Pick<ItemRow, 'id'>>
/** One hero drinks one city potion from its own kiosk: the bot's own `use_consumable` payload. */
export const potion_input = (id: string, hero: Hero, potion: Potion): DappInput => ({
  type: 'dapp/hero_direct',
  id,
  hero_id: hero.id,
  action: 'use_consumable',
  payload: { character_id: hero.id, item_id: potion.id, amount: 1 },
})
/** The potion of a city, for one hero that holds it. The bot signs one direct request at a time. */
export const DappPotionButton = ({ copy, hero, potion }: Readonly<{ copy: AppCopy; hero: Hero; potion: Potion }>) => {
  const free = useAppStore(({ dapp }) => direct_free(dapp))
  return (
    <Button
      disabled={!free}
      data-potion={hero.id}
      onClick={() => dispatch_app(potion_input(crypto.randomUUID(), hero, potion))}
    >
      {dapp_text(copy, 'travel_potion_use')}
    </Button>
  )
}
