// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BACKLOG 18 — the character-delete CONFIRM card: deletion is allowed once everything is
// unequipped, even for the free starter. Deletion is IRREVERSIBLE and the NAME stays reserved forever
// (derived_object has no unclaim), so the confirm is NAME-TYPED: the destroy button stays disarmed until
// the player types the character's exact name — stronger than hold-to-confirm for a permanent burn, and
// keyboard-accessible. Shared by BOTH drawer variants (in-world HUD list + the companion page master-
// detail); rides the existing .chr-confirm glass overlay + the house gothic-terminal tokens.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  const [typed, set_typed] = useState('')
  const name = String(character?.name ?? '')
  const armed = typed.trim().toLowerCase() === name.trim().toLowerCase() && name.length > 0

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
        <label className="chr-confirm__arm">
          <span className="chr-confirm__arm-label">
            {t('characters.delete.type_to_confirm', 'Type {{name}} to confirm', { name })}
          </span>
          <input
            className="chr-confirm__input"
            type="text"
            value={typed}
            placeholder={name}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={busy}
            onChange={(e) => set_typed(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && armed && !busy) on_confirm()
              if (e.key === 'Escape' && !busy) on_cancel()
            }}
          />
        </label>
        <div className="chr-confirm__actions">
          <button type="button" className="hud-btn" disabled={busy} onClick={on_cancel}>
            {t('common.cancel', 'Cancel')}
          </button>
          <button type="button" className="chr-confirm__del" disabled={busy || !armed} onClick={on_confirm}>
            {busy
              ? t('characters.delete.deleting', 'Deleting…')
              : t('characters.delete.confirm', 'Delete forever')}
          </button>
        </div>
      </div>
    </div>
  )
}
