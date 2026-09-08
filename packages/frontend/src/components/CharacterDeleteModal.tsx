// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { CHARACTER_PRICE_MIST } from '@aresrpg/sdk/character-price'
import { useState } from 'react'

import { character_deletion_blockers } from '../characters/character_deletion.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { format_sui } from '../wallet_amount.ts'
import { readable_transaction_error, run_direct_transaction } from '../transaction_guard.ts'

import { ModalFrame } from './ModalFrame.tsx'

const DeletionConfirmation = ({
  character_id,
  copy,
  close,
}: Readonly<{
  character_id: string
  copy: AppCopy
  close: () => void
}>) => {
  const state = useAppStore((state) => state)
  const [origin_wallet] = useState(state.session.wallet)
  const [busy, set_busy] = useState(false)
  const [error, set_error] = useState<string | null>(null)
  const character = state.session.characters.find(({ id }) => id === character_id)
  const blockers = character_deletion_blockers(state, character_id)
  const t = copy_text(copy.characters_page)
  const confirm = (): void => {
    const { wallet } = state.session
    if (busy || blockers.length || !character || !wallet || wallet !== origin_wallet) return
    const pending = run_direct_transaction(() =>
      wallet.character.delete({
        character_id,
        custody: { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap },
      })
    )
    if (!pending) return
    set_busy(true)
    set_error(null)
    void pending
      .then(() => {
        dispatch_app({ type: 'character/deleted', character_id, wallet })
      })
      .catch((error: unknown) => {
        console.error('Character deletion failed.', error)
        set_error(readable_transaction_error(error))
      })
      .finally(() => set_busy(false))
  }
  if (!character || state.session.wallet !== origin_wallet) return null
  return (
    <ModalFrame close={busy ? null : close} close_label={copy.wallet_close} label={t('delete_character')}>
      <div className="flex flex-col gap-4 p-6" data-character-delete="">
        <h2 className="pr-6 text-xs tracking-[0.18em] text-gold uppercase">{t('delete_character')}</h2>
        <p className="text-sm break-words text-text">{character.name}</p>
        <p className="text-xs leading-6 text-text">{t('delete_warning')}</p>
        <p className="text-xs leading-6 text-[#ff7d94]">
          {t('delete_no_refund', { amount: format_sui(CHARACTER_PRICE_MIST, 0) })}
        </p>
        {blockers.length > 0 && (
          <ul className="list-inside list-disc text-xs leading-6 text-[#ff7d94]">
            {blockers.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        )}
        {error && (
          <p className="text-xs break-words text-[#ff7d94]" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            className="cursor-pointer border border-border px-3 py-2 text-[10px] tracking-[0.12em] text-text uppercase hover:border-gold disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy}
            onClick={close}
            type="button"
          >
            {t('cancel')}
          </button>
          <button
            className="cursor-pointer border border-[#ff496c]/60 bg-[#ff496c]/10 px-3 py-2 text-[10px] tracking-[0.12em] text-[#ff7d94] uppercase hover:border-[#ff496c] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy || blockers.length > 0}
            onClick={confirm}
            type="button"
          >
            {busy ? t('delete_pending') : t('delete_character')}
          </button>
        </div>
      </div>
    </ModalFrame>
  )
}

export const CharacterDeleteModal = (
  props: Readonly<{
    character_id: string | null
    copy: AppCopy
    close: () => void
  }>
) =>
  props.character_id === null ? null : (
    <DeletionConfirmation {...props} character_id={props.character_id} key={props.character_id} />
  )
