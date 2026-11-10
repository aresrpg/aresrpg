// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, read_app_state } from '../store.ts'
import { toast } from '../toast.ts'

import { agent_tab_source } from './character_tabs.ts'

/** Reuse the existing server-authorized observation door; selecting a tab never grants control. */
export const watch_agent_character = (character_id: string, copy: AppCopy): void => {
  const { session } = read_app_state()
  const source = agent_tab_source(session)
  if (!source.pairing || !source.characters.some(({ id }) => id === character_id)) return
  try {
    const request = session.wallet?.read_agent_pairing_request?.(crypto.randomUUID())
    if (!request) throw new Error('Agent observation identity is unavailable.')
    dispatch_app({
      type: 'agent/watch',
      observation: {
        pairing: source.pairing,
        public_identifier: request.zklogin_public_identifier,
        character_id,
      },
    })
  } catch (error) {
    console.warn('Agent character observation could not start.', error)
    toast.add(copy.ui.agent_watch_failed, 'error')
  }
}
