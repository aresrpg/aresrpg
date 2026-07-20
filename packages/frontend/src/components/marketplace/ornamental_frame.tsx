// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
function FrameCorner({ position }: { position: 'tl' | 'tr' | 'bl' | 'br' }) {
  const is_top = position === 'tl' || position === 'tr'
  const is_left = position === 'tl' || position === 'bl'
  const accent = 'rgba(200,150,60,0.5)'

  return (
    <span
      aria-hidden="true"
      className="absolute w-4 h-4 pointer-events-none"
      style={{
        [is_top ? 'top' : 'bottom']: -1,
        [is_left ? 'left' : 'right']: -1,
        borderTop: is_top ? `2px solid ${accent}` : 'none',
        borderBottom: is_top ? 'none' : `2px solid ${accent}`,
        borderLeft: is_left ? `2px solid ${accent}` : 'none',
        borderRight: is_left ? 'none' : `2px solid ${accent}`,
      }}
    />
  )
}

export function MarketplaceFrameCorners() {
  return (
    <>
      <FrameCorner position="tl" />
      <FrameCorner position="tr" />
      <FrameCorner position="bl" />
      <FrameCorner position="br" />
    </>
  )
}

export function MarketplaceFrameOrnament() {
  return (
    <div aria-hidden="true" className="mkt-frame-ornament flex items-center justify-center gap-3 py-2">
      <span
        className="w-16 h-px"
        style={{ background: 'linear-gradient(to right, transparent, rgba(200,150,60,0.3))' }}
      />
      <span className="w-1.5 h-1.5 rotate-45 border border-gold/40" />
      <span className="w-1 h-1 bg-gold/30" />
      <span className="w-1.5 h-1.5 rotate-45 border border-gold/40" />
      <span
        className="w-16 h-px"
        style={{ background: 'linear-gradient(to left, transparent, rgba(200,150,60,0.3))' }}
      />
    </div>
  )
}
