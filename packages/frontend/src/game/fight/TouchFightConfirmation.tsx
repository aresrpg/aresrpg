// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Check, X } from 'lucide-react'
import './touch_fight_confirmation.css'

import type { AppCopy } from '../../i18n/copy.ts'

export const TouchFightConfirmation = ({
  visible,
  copy,
  cancel,
  confirm,
}: Readonly<{ visible: boolean; copy: AppCopy; cancel: () => void; confirm: () => void }>) =>
  visible ? (
    <div className="fight-touch-confirm" data-touch-fight-confirm>
      <button
        className="fight-touch-cancel"
        aria-label={String(copy.characters_page.cancel)}
        onClick={cancel}
        type="button"
      >
        <X size={24} aria-hidden="true" />
      </button>
      <button className="fight-touch-accept" aria-label={copy.ui.mobile_confirm_action} onClick={confirm} type="button">
        <Check size={24} aria-hidden="true" />
      </button>
    </div>
  ) : null
