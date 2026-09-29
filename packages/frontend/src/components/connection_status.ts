// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AppCopy } from '../i18n/copy.ts'
import type { SessionState } from '../modules/session.ts'
export const connection_label = (
  copy: AppCopy,
  session: Pick<SessionState, 'link_status' | 'link_error' | 'link_violation'>
): string => {
  if (session.link_violation) return copy.server_violation
  return {
    idle: copy.server_disconnected,
    replaced: copy.server_replaced,
    ready: copy.server_connected,
    connected: copy.server_syncing,
    connecting: session.link_error ? copy.server_reconnecting : copy.server_connecting,
  }[session.link_status]
}
export const indexing_health_tone = (lag: number | null): 'unknown' | 'healthy' | 'catching_up' | 'lagging' =>
  lag === null ? 'unknown' : lag < 10 ? 'healthy' : lag <= 50 ? 'catching_up' : 'lagging'
