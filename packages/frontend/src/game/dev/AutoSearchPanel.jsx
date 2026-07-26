// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AUTO-SEARCH PANEL (#1106) — the dev scouter's container: one compact row directly under the world panel
// in the social cluster. It holds no state of its own; every press is one typed input through the fold's
// door (auto_search.js) and every rendered fact is read back off the scouter atom.
//
// THE FEE DISCLOSURE is not this component's opinion: the fold REFUSES to arm on a `toggle` — it raises
// `fee_pending`, and only `fee_confirm` arms the loop. So every enable shows the modal, carried by the
// house ConfirmDialog (never a native dialog). Opening the settings sheet is a hard stop by the same law.

import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '../screens/hud/world/ConfirmDialog.jsx'

import {
  auto_search_input,
  use_auto_search,
  use_auto_search_driver,
  use_mob_templates,
  use_world_mob_ids,
} from './auto_search_adapter.js'
import { AutoSearchRow, AutoSearchSheet } from './auto_search_view.jsx'
import './auto-search.css'

/** @returns {import('react').ReactElement} */
export function AutoSearchPanel() {
  const { t } = useTranslation()
  const armed = use_auto_search((state) => state.armed)
  const fee_pending = use_auto_search((state) => state.fee_pending)
  const config_open = use_auto_search((state) => state.config_open)
  const from_m = use_auto_search((state) => state.from_m)
  const to_m = use_auto_search((state) => state.to_m)
  const wanted = use_auto_search((state) => state.wanted)

  // The roster the sheet picks from — the bestiary's own /v1 door, read only while the sheet is open or a
  // running loop may need to name a find, and SCOPED to the mobs the current world can actually spawn (the
  // World doc's own table; it also prunes a selection the new world cannot spawn, through the fold's door).
  const world_mob_ids = use_world_mob_ids()
  const { rows, loading } = use_mob_templates(config_open || armed, world_mob_ids)
  use_auto_search_driver(rows)

  return (
    <>
      <AutoSearchRow
        armed={armed}
        on_toggle={(next) => auto_search_input({ type: 'toggle', value: next })}
        on_config={() => auto_search_input({ type: 'config_open' })}
      />

      <ConfirmDialog
        open={fee_pending}
        title={t('auto_search.fee_title')}
        message={t('auto_search.fee_message')}
        confirm_label={t('auto_search.fee_confirm')}
        cancel_label={t('common.cancel')}
        on_confirm={() => auto_search_input({ type: 'fee_confirm' })}
        on_cancel={() => auto_search_input({ type: 'fee_cancel' })}
      />

      {config_open && (
        <AutoSearchSheet
          from_m={from_m}
          to_m={to_m}
          wanted={wanted}
          rows={rows}
          loading={loading}
          on_range={(next) => auto_search_input({ type: 'config_set', from_m, to_m, ...next })}
          on_toggle_mob={(template_id) =>
            auto_search_input({
              type: 'config_set',
              wanted: wanted.includes(template_id)
                ? wanted.filter((id) => id !== template_id)
                : [...wanted, template_id],
            })
          }
          on_close={() => auto_search_input({ type: 'config_close' })}
        />
      )}
    </>
  )
}
