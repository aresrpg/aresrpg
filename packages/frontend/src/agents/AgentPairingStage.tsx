// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useId } from 'react'

import type { AppCopy } from '../i18n/copy.ts'

import type { PairingState } from './pairing_state.ts'

export type PairingProvider = Readonly<{ label: string; logo: string }>

/** Presentation follows the existing pairing reducer; animation never establishes a connection. */
export const AgentPairingStage = ({
  copy,
  state,
  provider,
  failure,
}: Readonly<{
  copy: AppCopy
  state: Exclude<PairingState['status'], 'idle'>
  provider?: PairingProvider
  failure?: string
}>) => {
  const halo_id = useId()
  const title =
    state === 'verified'
      ? copy.ui.agent_connected
      : state === 'failed'
        ? copy.ui.agent_pair_failed_title
        : copy.ui.agent_pair_pending
  return (
    <div className="agent-pair-stage" data-pair-state={state}>
      <svg className="agent-pair-sigil" viewBox="0 0 320 112" aria-hidden="true">
        <defs>
          <radialGradient id={halo_id}>
            <stop offset="0%" stopColor="#c8a35a" stopOpacity=".3" />
            <stop offset="60%" stopColor="#c8a35a" stopOpacity=".07" />
            <stop offset="100%" stopColor="#c8a35a" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path className="agent-pair-track" d="M76 56h50m68 0h50" />
        <path className="agent-pair-flow" d="M76 56h50m118 0h-50" />
        <circle className="agent-pair-halo" cx="160" cy="56" r="48" fill={`url(#${halo_id})`} />
        <g className="agent-pair-spin">
          <circle className="agent-pair-ticks" cx="160" cy="56" r="34" />
        </g>
        <circle className="agent-pair-ring" cx="160" cy="56" r="24" />
        <g className="agent-pair-orbit agent-pair-orbit-a">
          <circle cx="194" cy="56" r="2.6" />
          <circle cx="126" cy="56" r="1.8" opacity=".5" />
        </g>
        <g className="agent-pair-orbit agent-pair-orbit-b">
          <circle cx="160" cy="14" r="2" opacity=".5" />
        </g>
        <path className="agent-pair-rune" d="M160 44l3 9 9 3-9 3-3 9-3-9-9-3 9-3Z" />
        <path className="agent-pair-check" d="m149.5 56.5 6.5 6.5 13-14" />
        <path className="agent-pair-failed" d="m154 50 12 12m0-12-12 12" />
        <circle className="agent-pair-node" cx="54" cy="56" r="21" />
        <circle className="agent-pair-ring" cx="54" cy="56" r="14" />
        <path className="agent-pair-glyph" fillRule="evenodd" d="m54 47 9 9-9 9-9-9Zm0 4.5 4.5 4.5-4.5 4.5-4.5-4.5Z" />
        <text className="agent-pair-caption" x="54" y="98">
          AresRPG
        </text>
        <circle className="agent-pair-node" cx="266" cy="56" r="21" />
        <circle className="agent-pair-ring" cx="266" cy="56" r="14" />
        {provider && (
          <image href={provider.logo} x="255" y="45" width="22" height="22" style={{ colorScheme: 'dark' }} />
        )}
        <text className="agent-pair-caption" x="266" y="98">
          {provider?.label}
        </text>
      </svg>
      <div className="agent-pair-message" role={state === 'failed' ? 'alert' : 'status'}>
        <p className="agent-pair-title">{title}</p>
        {state === 'failed' && <p className="agent-pair-failure">{failure}</p>}
      </div>
    </div>
  )
}
