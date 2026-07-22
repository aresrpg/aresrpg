// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ISSUE 176 — the character-delete CONFIRM card: deletion is allowed once everything is unequipped,
// even for the free starter. Deletion is IRREVERSIBLE and the NAME stays reserved forever
// (derived_object has no unclaim), so opening the card is only the first confirmation: the destructive
// action stays disarmed until the player ticks the explicit acknowledgement checkbox. This mirrors the
// item-send review idiom without asking for typed text and rides the house gothic-terminal tokens.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/** @param {boolean} acknowledged @param {boolean} busy @returns {boolean} */
export const delete_confirm_ready = (acknowledged, busy) => acknowledged && !busy

/**
 * @param {{
 *   character: { id: string, name: string },
 *   busy: boolean,
 *   on_cancel: () => void,
 *   on_confirm: () => void,
 * }} props
 */
export function CharacterDeleteConfirm({ character, busy, on_cancel, on_confirm }) {
  const { t } = useTranslation()
  const [ack, set_ack] = useState(false)
  const name = String(character?.name ?? '')
  const ready = delete_confirm_ready(ack, busy)

  return (
    <div
      className="chr-confirm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) on_cancel()
      }}
    >
      <div className="chr-confirm__card" role="alertdialog" aria-modal="true" aria-label={t('characters.delete.title', 'Delete character')}>
        <h3>{t('characters.delete.title', 'Delete character')}</h3>
        <p>{t('characters.delete.warning', 'This permanently destroys {{name}} and everything it has learned. There is no undo.', { name })}</p>
        <p className="chr-confirm__note">
          {t('characters.delete.name_reserved', 'The name stays reserved forever. Even you cannot reuse it.')}
        </p>
        <label className="chr-confirm__ack">
          <input
            type="checkbox"
            checked={ack}
            autoFocus
            disabled={busy}
            onChange={(event) => set_ack(event.target.checked)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !busy) on_cancel()
            }}
          />
          <span>
            {t(
              'characters.delete.confirm_checkbox',
              'I understand that {{name}} will be permanently deleted and cannot be recovered.',
              { name }
            )}
          </span>
        </label>
        <div className="chr-confirm__actions">
          <button type="button" className="hud-btn" disabled={busy} onClick={on_cancel}>
            {t('common.cancel', 'Cancel')}
          </button>
          <button type="button" className="chr-confirm__del" disabled={!ready} onClick={on_confirm}>
            {busy
              ? t('characters.delete.deleting', 'Deleting…')
              : t('characters.delete.confirm', 'Delete forever')}
          </button>
        </div>
      </div>
    </div>
  )
}
