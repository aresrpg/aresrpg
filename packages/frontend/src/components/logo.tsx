// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export function Logo({ size = 80 }: { size?: number }) {
  return (
    <div className="relative flex items-center justify-center" style={{ animation: 'float 6s ease-in-out infinite' }}>
      <div
        className="absolute"
        style={{
          width: size * 1.5,
          height: size * 1.5,
          background: 'radial-gradient(circle, rgba(74, 158, 255, 0.15) 0%, transparent 70%)',
          filter: 'blur(20px)',
        }}
      />
      <img
        src="/logo.png"
        alt="AresRPG"
        width={size}
        height={size}
        className="relative drop-shadow-[0_0_20px_rgba(200,150,60,0.3)]"
      />
    </div>
  )
}
