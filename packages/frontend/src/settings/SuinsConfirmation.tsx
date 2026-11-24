// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button, GameWindow, NativeModal } from '@aresrpg/ui'

import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

export const SuinsConfirmation = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const request = useAppStore(({ suins }) => suins.request)
  const t = copy_text(copy.settings_page)
  if (request?.kind !== 'set' || request.stage !== 'review' || !request.review) return null
  const { review, name } = request
  const cancel = () => dispatch_app({ type: 'suins/cancel' })
  return (
    <NativeModal close={cancel} label={t('suins_confirm_title')} className="aui-modal-scrim">
      <GameWindow
        title={t('suins_confirm_title')}
        close={cancel}
        close_label={copy.wallet_close}
        className="aui-confirm [&>header]:shrink-0"
      >
        <div className="min-h-0 space-y-4 overflow-y-auto break-words px-5 py-4 text-xs leading-6 text-muted">
          {review.erased_names.length > 0 && (
            <p className="text-text">{t('suins_confirm_erase', { names: review.erased_names.join(', ') })}</p>
          )}
          <div>
            <p>{t('suins_confirm_player', { name: `aresrpg.${name}` })}</p>
            <p className="mt-1 break-all font-mono text-[10px] text-text">{review.player_address}</p>
          </div>
          <div>
            <p>{t('suins_confirm_agent', { name: `aresrpgagent.${name}` })}</p>
            <p className="mt-1 break-all font-mono text-[10px] text-text">{review.agent_address}</p>
          </div>
          <p>{t('suins_confirm_parent', { name })}</p>
        </div>
        <div className="aui-confirm-actions shrink-0 flex-wrap">
          <Button type="button" onClick={cancel}>
            {copy.ui.agent_cancel}
          </Button>
          <Button type="button" tone="primary" onClick={() => dispatch_app({ type: 'suins/confirm' })}>
            {t('suins_confirm_apply')}
          </Button>
        </div>
      </GameWindow>
    </NativeModal>
  )
}
