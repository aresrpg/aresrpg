// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Button, SettingRow } from '@aresrpg/ui'

import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

export const JourneySettings = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const ready = useAppStore((state) => state.journey.ready && state.journey.identity !== null)
  const saving = useAppStore((state) => state.journey.saving)
  const text = copy_text(copy.journey)
  return (
    <SettingRow title={text('reset_title')} description={text('reset_hint')}>
      <div className="settings-actions">
        <Button disabled={!ready} onClick={() => dispatch_app({ type: 'journey/journal', open: true })} type="button">
          {text('journal')}
        </Button>
        <Button disabled={!ready} onClick={() => dispatch_app({ type: 'journey/reset' })} type="button">
          {text(saving ? 'saving' : 'reset_action')}
        </Button>
      </div>
    </SettingRow>
  )
}
