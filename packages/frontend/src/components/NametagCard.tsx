// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE NAMETAG — the house's one identity card: gold ornament corners, a center diamond, a name
// in warm mono caps, and a stack of detail lines beneath it. It is a pure presentation shell
// with no idea what it labels, because the same card names a player over their crown, a mob
// group over its pack, a resource node over its block, and the zone under the compass. One
// design, one file: a second copy of these ornaments is how two of them drift apart.

import type { ReactNode } from 'react'

/** A line on the card.
 *  - `title` carries the name's own weight and warmth — a mob pack has no header, so each of its
 *    members is a title in its own right.
 *  - `muted` reads as a requirement not yet met — the gather gate's "you need a pickaxe" — so a
 *    card states a refusal in the same shape as an offer.
 *  Default is the quiet subtitle: an affordance line ("press E…"), never the subject itself. */
export type NametagLine = Readonly<{ key: string; text: ReactNode; title?: boolean; muted?: boolean }>

export const NametagCard = ({
  name,
  lines = [],
  tone = 'gold',
}: Readonly<{ name?: ReactNode; lines?: readonly NametagLine[]; tone?: 'gold' | 'muted' }>) => {
  const edge = tone === 'gold' ? 'rgba(200,150,60,0.70)' : 'rgba(120,124,134,0.55)'
  const glow = tone === 'gold' ? '0 0 14px rgba(200,150,60,0.10)' : '0 0 14px rgba(0,0,0,0.10)'
  return (
    <div className="pointer-events-none -translate-y-full">
      <div
        className="relative flex flex-col items-center gap-0.5 rounded-lg border bg-bg/85 px-3 py-1.5 text-center backdrop-blur-md"
        style={{
          borderColor: tone === 'gold' ? 'rgba(200,150,60,0.25)' : 'rgba(120,124,134,0.22)',
          boxShadow: `${glow}, 0 4px 18px rgba(0,0,0,0.5)`,
        }}
      >
        {/* ornament corners — hairline brackets */}
        <span className="absolute top-0 left-0 h-2 w-2 border-t border-l" style={{ borderColor: edge }} />
        <span className="absolute top-0 right-0 h-2 w-2 border-t border-r" style={{ borderColor: edge }} />
        <span className="absolute bottom-0 left-0 h-2 w-2 border-b border-l" style={{ borderColor: edge }} />
        <span className="absolute right-0 bottom-0 h-2 w-2 border-r border-b" style={{ borderColor: edge }} />
        {/* center diamond above the name */}
        <span
          className="absolute -top-[5px] left-1/2 h-[7px] w-[7px] -translate-x-1/2 rotate-45 border bg-bg"
          style={{ borderColor: tone === 'gold' ? 'rgba(200,150,60,0.80)' : 'rgba(120,124,134,0.6)' }}
        />
        {/* a card with no name is ALL list — a mob pack is its roster, and a "Pack of 3" header
            over three named rows only says the same thing twice */}
        {name !== undefined && (
          <span
            className="font-mono text-[10px] leading-tight tracking-[0.16em] uppercase"
            style={{ color: tone === 'gold' ? '#f5d0a9' : '#b9bcc4' }}
          >
            {name}
          </span>
        )}
        {lines.length > 0 && (
          <>
            {name !== undefined && <span className="h-px w-6" style={{ background: 'rgba(200,150,60,0.35)' }} />}
            <span className="flex flex-col items-center gap-px">
              {lines.map((line) =>
                line.title ? (
                  <span
                    className="font-mono text-[10px] leading-tight tracking-[0.16em] uppercase"
                    key={line.key}
                    style={{ color: tone === 'gold' ? '#f5d0a9' : '#b9bcc4' }}
                  >
                    {line.text}
                  </span>
                ) : (
                  <span
                    className="font-mono text-[7px] leading-tight tracking-[0.18em] uppercase"
                    key={line.key}
                    style={{ color: line.muted ? '#777b86' : '#a3a5ad' }}
                  >
                    {line.text}
                  </span>
                )
              )}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
