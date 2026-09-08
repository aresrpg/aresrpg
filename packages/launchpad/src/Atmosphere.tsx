// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useRef } from 'react'

/** Decorative layers share image coordinates; the browser owns their animation timelines. */
export const Atmosphere = () => {
  const flow = useRef<SVGAnimateElement>(null)
  useEffect(() => {
    const animation = flow.current
    const svg = animation?.ownerSVGElement
    if (!animation || !svg) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const synchronize = (): void => {
      if (reduced.matches || document.hidden) svg.pauseAnimations()
      else svg.unpauseAnimations()
    }
    // CSS filter references attach after SVG insertion; start only once the complete tree is mounted.
    animation.beginElement()
    synchronize()
    reduced.addEventListener('change', synchronize)
    document.addEventListener('visibilitychange', synchronize)
    return () => {
      reduced.removeEventListener('change', synchronize)
      document.removeEventListener('visibilitychange', synchronize)
      animation.endElement()
    }
  }, [])
  return (
    <div aria-hidden="true" className="launch-atmosphere" data-launch-atmosphere="">
      <svg className="absolute size-px overflow-hidden" focusable="false">
        <defs>
          <filter id="launch-water-distortion" x="0" y="0.69" width="1" height="0.23">
            <feTurbulence type="fractalNoise" baseFrequency="0.012 0.08" numOctaves="1" seed="4" result="water-noise" />
            <feOffset in="water-noise" result="water-flow">
              <animate
                ref={flow}
                attributeName="dx"
                begin="indefinite"
                values="0;24;0"
                dur="8s"
                repeatCount="indefinite"
              />
            </feOffset>
            <feDisplacementMap
              in="SourceGraphic"
              in2="water-flow"
              scale="7"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
      <div className="launch-atmosphere-scene">
        <div className="launch-atmosphere-image" />
        <div className="launch-atmosphere-trees" />
        <div className="launch-atmosphere-water" />
        <div className="launch-atmosphere-wind" />
      </div>
      <div className="launch-atmosphere-shade" />
      <div className="launch-atmosphere-scene">
        {[
          [20, 74],
          [22, 80],
          [82, 76],
          [84, 81],
        ].map(([left, top], index) => (
          <i
            className="launch-atmosphere-reflection"
            key={left}
            style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${index * -1.3}s` }}
          />
        ))}
      </div>
      <div className="launch-atmosphere-stars">
        {[
          [3, 8],
          [9, 20],
          [15, 5],
          [31, 9],
          [44, 3],
          [58, 7],
          [72, 4],
          [87, 9],
          [96, 18],
          [98, 34],
          [5, 38],
          [11, 29],
        ].map(([left, top], index) => (
          <i
            className="launch-atmosphere-star"
            key={left}
            style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${index * -0.8}s` }}
          />
        ))}
      </div>
      <div className="launch-atmosphere-grain" />
    </div>
  )
}
