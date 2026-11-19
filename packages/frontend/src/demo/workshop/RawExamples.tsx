// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import {
  Button,
  ConfirmDialog,
  GameWindow,
  IconButton,
  KeyHint,
  NavigationRow,
  NotificationCard,
  Panel,
  ProgressBar,
} from '@aresrpg/ui'

import { item_icon } from '../../content/assets.ts'
import { content_catalog } from '../../content/catalog.ts'
import type { AppCopy } from '../../i18n/copy.ts'
import inventory_icon from '../../assets/quickslots/inventory.png'

const SAMPLE_ITEM = content_catalog.items[0]!
const SURFACE_TOKENS = ['void', 'bg', 'sunk', 'surface', 'raised', 'lifted', 'high', 'peak', 'steel'] as const
const INK_TOKENS = ['faint', 'muted', 'soft', 'ink'] as const
const ACCENT_TOKENS = ['brass-lo', 'brass', 'brass-hi', 'orange', 'blue', 'success', 'danger'] as const

const WindowsExample = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [dialog, set_dialog] = useState<'neutral' | 'danger' | null>(null)
  const [row, set_row] = useState(0)
  return (
    <div className="ui-workshop-grid">
      <GameWindow
        title={copy.settings}
        icon={<img src={inventory_icon} alt="" />}
        hotkey="E"
        close={() => undefined}
        close_label={copy.wallet_close}
      >
        <div className="ui-workshop-window-body">
          {[copy.quality, copy.ui.design_volume, copy.ui.design_motion].map((label, index) => (
            <NavigationRow key={label} selected={row === index} onClick={() => set_row(index)}>
              {label}
            </NavigationRow>
          ))}
        </div>
      </GameWindow>
      <Panel>
        <h2>{copy.ui.design_dialog}</h2>
        <div className="ui-workshop-row">
          <Button onClick={() => set_dialog('neutral')}>{copy.ui.design_dialog}</Button>
          <Button tone="danger" onClick={() => set_dialog('danger')}>
            {copy.ui.leave_game_confirm}
          </Button>
        </div>
      </Panel>
      {dialog && (
        <ConfirmDialog
          title={copy.ui.leave_game_title}
          cancel_label={copy.ui.stay_in_game}
          confirm_label={copy.ui.leave_game_confirm}
          close_label={copy.wallet_close}
          on_cancel={() => set_dialog(null)}
          on_confirm={() => set_dialog(null)}
          danger={dialog === 'danger'}
        />
      )}
    </div>
  )
}

const FeedbackExample = ({ copy }: Readonly<{ copy: AppCopy }>) => (
  <div className="ui-workshop-grid">
    <Panel>
      <h2>{copy.ui.design_feedback}</h2>
      <ProgressBar label={copy.quality} value={64} max={100} detail="64 / 100" />
      <ProgressBar label={copy.ui.design_volume} value={12} max={100} detail="12 / 100" />
      <div className="ui-workshop-row">
        <Button busy>{copy.loading_universe}</Button>
        <KeyHint>E</KeyHint>
        <KeyHint>Esc</KeyHint>
        <IconButton icon={<img src={inventory_icon} alt="" />} label={copy.settings} hotkey="E" />
      </div>
    </Panel>
    {(['gold', 'blue'] as const).map((tone) => (
      <NotificationCard
        key={tone}
        type={copy.ui.design_feedback}
        tone={tone}
        title={SAMPLE_ITEM.name}
        subtitle={copy.ui.design_library}
        image={item_icon(SAMPLE_ITEM.item_type) ?? inventory_icon}
        summary={`Lv. ${SAMPLE_ITEM.level}`}
      />
    ))}
  </div>
)

const Swatches = ({ names }: Readonly<{ names: readonly string[] }>) => (
  <div className="ui-workshop-swatches">
    {names.map((name) => (
      <figure key={name}>
        <span style={{ background: `var(--aui-${name})` }} />
        <figcaption>{`--aui-${name}`}</figcaption>
      </figure>
    ))}
  </div>
)

const TokensExample = ({ copy }: Readonly<{ copy: AppCopy }>) => (
  <div className="ui-workshop-grid">
    <Panel>
      <h2>{copy.ui.design_tokens}</h2>
      <Swatches names={SURFACE_TOKENS} />
      <Swatches names={INK_TOKENS} />
      <Swatches names={ACCENT_TOKENS} />
    </Panel>
    <Panel>
      <h2>{copy.ui.design_library}</h2>
      <h3>{copy.ui.design_components}</h3>
      <p>{copy.ui.mobile_rotate}</p>
    </Panel>
  </div>
)

export const RAW_PANELS = { windows: WindowsExample, feedback: FeedbackExample, tokens: TokensExample }
export type RawView = keyof typeof RAW_PANELS
export const raw_options = (copy: AppCopy): readonly Readonly<{ value: RawView; label: string }>[] => [
  { value: 'windows', label: copy.ui.design_windows },
  { value: 'feedback', label: copy.ui.design_feedback },
  { value: 'tokens', label: copy.ui.design_tokens },
]
