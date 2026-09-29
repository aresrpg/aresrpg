// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { Button } from '@aresrpg/ui'
import { Loader2 } from 'lucide-react'
import type { CharacterRow } from '@aresrpg/protocol'

import { Text } from '../i18n/Text.tsx'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import { parse_kolizeum_pledge, type KolizeumInput } from '../modules/kolizeum.ts'
export type Format = 1 | 3 | 6
const FORMATS = [1, 3, 6] as const
export const FormatChips = ({
  active,
  pick,
}: Readonly<{ active: Format | null; pick: (format: Format | null) => void }>) => (
  <span className="kz-chips">
    {FORMATS.map((format) => (
      <Button
        aria-pressed={active === format}
        className={active === format ? 'is-active' : ''}
        key={format}
        onClick={() => pick(active === format ? null : format)}
        type="button"
      >
        <Text path="ui.team_format" values={{ size: format }} />
      </Button>
    ))}
  </span>
)

const create_available = (
  character: Readonly<CharacterRow> | null,
  pledge: bigint | null,
  pending: string | null,
  access: 'public' | 'friends',
  has_friends: boolean
): boolean =>
  !!character &&
  character.custody === 'kiosk' &&
  pledge !== null &&
  pending === null &&
  (access === 'public' || has_friends)

export const KolizeumCreate = ({
  copy,
  selected_character,
  pending,
  has_friends,
  dispatch,
}: Readonly<{
  copy: AppCopy
  selected_character: Readonly<CharacterRow> | null
  pending: string | null
  has_friends: boolean
  dispatch: (input: KolizeumInput) => void
}>) => {
  const localized_numbers = useNumbers(),
    t = copy_text(copy.kolizeum_page)
  const [form_format, set_form_format] = useState<Format>(3)
  const [access, set_access] = useState<'public' | 'friends'>('public')
  const [pledge, set_pledge] = useState('1.00')
  const [max_diff, set_max_diff] = useState('10')
  const pledge_mist = parse_kolizeum_pledge(pledge)
  const can_create = create_available(selected_character, pledge_mist, pending, access, has_friends)
  const create = (): void => {
    if (!can_create || pledge_mist === null) return
    dispatch({
      type: 'kolizeum/create',
      format: form_format,
      pledge_mist,
      max_level_diff: Math.max(0, Number(max_diff) || 0),
      access,
    })
  }
  return (
    <form
      className="kz-create"
      onSubmit={(event) => {
        event.preventDefault()
        create()
      }}
    >
      <div className="kz-create-fields">
        <div className="kz-create-field">
          <label>{t('form_format')}</label>
          <FormatChips active={form_format} pick={(format) => format && set_form_format(format)} />
        </div>
        <div className="kz-create-field">
          <label>{t('form_access')}</label>
          <span className="kz-chips">
            <Button
              className={access === 'public' ? 'is-active' : ''}
              onClick={() => set_access('public')}
              type="button"
            >
              {t('access_public')}
            </Button>
            <Button
              className={access === 'friends' ? 'is-active' : ''}
              disabled={!has_friends}
              onClick={() => set_access('friends')}
              type="button"
            >
              {t('access_friends')}
            </Button>
          </span>
        </div>
        <div className="kz-create-field">
          <label>{t('form_pledge')}</label>
          <input
            className="template-input"
            inputMode="decimal"
            onChange={(event) => set_pledge(event.target.value)}
            value={pledge}
          />
        </div>
        <div className="kz-create-field">
          <label>{t('form_max_diff')}</label>
          <input
            className="template-input"
            inputMode="numeric"
            onChange={(event) => set_max_diff(event.target.value.replace(/[^0-9]/g, ''))}
            value={max_diff}
          />
        </div>
        <div className="kz-create-field">
          <label>{t('form_character')}</label>
          {selected_character ? (
            <div className="kz-character">
              <b>{selected_character.name}</b>
              <span>{selected_character.classe}</span>
              <small>
                <Text path="encyclopedia_page.level_short" values={{ level: selected_character.level }} />
              </small>
            </div>
          ) : (
            <p>{t('no_character')}</p>
          )}
        </div>
      </div>
      <div className="kz-create-footer">
        <p>
          {t('full_pot_summary', {
            pot: localized_numbers.sui((pledge_mist ?? 0n) * BigInt(form_format) * 2n, 2),
            format: copy_text(copy.ui)('team_format', { size: form_format }),
          })}
        </p>
        <Button className="kz-create-button" tone="primary" disabled={!can_create} type="submit">
          {pending === 'create' && <Loader2 aria-hidden="true" className="animate-spin" size={11} />}
          {t('create_cta')}
        </Button>
      </div>
    </form>
  )
}
