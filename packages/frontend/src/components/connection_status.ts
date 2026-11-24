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

type IndexingHealth = ReturnType<typeof indexing_health_tone>

/** One mark for the connection and the indexer together: trouble on the link wins, then the indexer's health. */
export const status_tone = (
  session: Pick<SessionState, 'link_status' | 'link_error' | 'link_violation' | 'indexing_lag'>
): IndexingHealth => {
  if (session.link_status === 'ready') return indexing_health_tone(session.indexing_lag)
  const trouble =
    session.link_error ?? session.link_violation ?? (session.link_status === 'replaced' ? 'replaced' : null)
  return trouble ? 'lagging' : 'unknown'
}
