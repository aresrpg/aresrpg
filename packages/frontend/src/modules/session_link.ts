// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

type LinkState = Readonly<{
  link_status: 'idle' | 'connecting' | 'connected' | 'ready' | 'replaced'
  link_error: string | null
  link_violation: string | null
  latency_ms: number | null
  indexing_lag: number | null
  current_epoch: string | null
}>

type LinkInput = Readonly<{ type: string; reason?: unknown; error?: unknown }>

const message = (value: unknown): string | null => (typeof value === 'string' ? value : null)

export const fold_link_input = <T extends LinkState>(session: T, input: LinkInput): T => {
  if (input.type === 'link/connecting')
    return {
      ...session,
      link_status: 'connecting',
      link_error: null,
      latency_ms: null,
      indexing_lag: null,
      current_epoch: null,
    }
  if (input.type === 'link/rejected' || input.type === 'link/replaced')
    return {
      ...session,
      link_status: input.type === 'link/replaced' ? 'replaced' : 'idle',
      link_error: input.type === 'link/rejected' ? message(input.reason) : null,
      latency_ms: null,
      indexing_lag: null,
      current_epoch: null,
    }
  if (input.type === 'link/violation')
    return {
      ...session,
      link_status: 'idle',
      link_error: message(input.reason),
      link_violation: message(input.reason),
      latency_ms: null,
      current_epoch: null,
    }
  if (input.type === 'link/failed')
    return {
      ...session,
      link_status: 'connecting',
      link_error: message(input.error),
      latency_ms: null,
      indexing_lag: null,
      current_epoch: null,
    }
  return session
}
