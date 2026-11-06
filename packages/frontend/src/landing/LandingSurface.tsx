// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Draft authored by Claude Opus 5.5 (claude-opus-5-5): the accepted continuous living background, ported unchanged.
import type { CSSProperties } from 'react'

import type { LandingAssets } from './landing_types.ts'

/** One fixed raster at one uniform scale, edge to edge. The tone curve caps every pixel at 40% per channel so copy
 * on the art stays >= 5:1; every animated effect colour stays at or below that cap. */
export const LANDING_TONE_ID = 'aresrpg-landing-tone'
const TONE_TABLE = '0 .095 .18 .25 .30 .335 .36 .375 .388 .396 .40'

type Effect = Readonly<{ kind: 'glow' | 'glow cy' | 'fall' | 'glint' | 'glint cy'; style: string }>

/** Percent-of-raster positions measured on the delivered 973x1616 desktop and 921x1708 phone art. */
const DESKTOP_EFFECTS: readonly Effect[] = [
  { kind: 'glow', style: '--x:6.47;--y:11.14;--d:5.6s' },
  { kind: 'glow', style: '--x:93.53;--y:12.38;--d:6.1s;--dl:-2s' },
  { kind: 'glow', style: '--x:96.4;--y:23.7;--d:7.3s;--dl:-1s' },
  { kind: 'glow', style: '--x:15.93;--y:28.16;--d:4.9s;--dl:-3s' },
  { kind: 'glow', style: '--x:4.11;--y:32.49;--d:6.6s;--dl:-.5s' },
  { kind: 'glow', style: '--x:85.3;--y:27.97;--d:5.3s;--dl:-4s' },
  { kind: 'glow cy', style: '--x:10.28;--y:61.26;--d:6.8s' },
  { kind: 'glow cy', style: '--x:87.15;--y:61.57;--d:7.4s;--dl:-3s' },
  { kind: 'glow', style: '--x:9.46;--y:65.28;--d:5.8s;--dl:-1.5s' },
  { kind: 'glow', style: '--x:82.84;--y:65.28;--d:6.2s;--dl:-2.5s' },
  { kind: 'glow cy', style: '--x:84.58;--y:73.64;--d:8s;--dl:-5s' },
  { kind: 'fall', style: '--x:87.15;--y:15.16;--w:1.23;--h:3.71' },
  { kind: 'fall', style: '--x:70.91;--y:17.33;--w:1.23;--h:3.09' },
  { kind: 'fall', style: '--x:34.74;--y:20.92;--w:1.03;--h:1.73' },
  { kind: 'fall', style: '--x:58.79;--y:22.77;--w:1.23;--h:1.98' },
  { kind: 'fall', style: '--x:19.53;--y:44.25;--w:1.64;--h:3.71' },
  { kind: 'fall', style: '--x:82.53;--y:46.91;--w:1.85;--h:3.84' },
  { kind: 'fall', style: '--x:78.93;--y:51.55;--w:1.85;--h:4.83' },
  { kind: 'fall', style: '--x:70.91;--y:80.75;--w:1.44;--h:3.22' },
  { kind: 'glint', style: '--x:19.53;--y:89.11;--w:5.14;--d:3.8s' },
  { kind: 'glint', style: '--x:21.07;--y:91.27;--w:3.6;--d:4.4s;--dl:-1.6s' },
  { kind: 'glint', style: '--x:81.19;--y:89.42;--w:5.1;--d:4.1s;--dl:-2.2s' },
  { kind: 'glint', style: '--x:82.22;--y:91.89;--w:3.6;--d:3.5s;--dl:-.8s' },
  { kind: 'glint cy', style: '--x:72.97;--y:89.11;--w:3;--d:5s;--dl:-3s' },
]

const PHONE_EFFECTS: readonly Effect[] = [
  { kind: 'glow', style: '--x:7.38;--y:13.58;--d:5.6s' },
  { kind: 'glow', style: '--x:93.05;--y:14.93;--d:6.1s;--dl:-2s' },
  { kind: 'glow', style: '--x:95.55;--y:27.22;--d:7.3s;--dl:-1s' },
  { kind: 'glow', style: '--x:17.92;--y:33.67;--d:4.9s;--dl:-3s' },
  { kind: 'glow', style: '--x:83.6;--y:31.62;--d:5.3s;--dl:-4s' },
  { kind: 'glow cy', style: '--x:11.4;--y:62.94;--d:6.8s' },
  { kind: 'glow cy', style: '--x:85.78;--y:63.23;--d:7.4s;--dl:-3s' },
  { kind: 'glow', style: '--x:10.64;--y:66.74;--d:5.8s;--dl:-1.5s' },
  { kind: 'glow', style: '--x:81.21;--y:66.74;--d:6.2s;--dl:-2.5s' },
  { kind: 'glow cy', style: '--x:83.39;--y:74.65;--d:8s;--dl:-5s' },
  { kind: 'fall', style: '--x:87.73;--y:17.86;--w:1.52;--h:4.39' },
  { kind: 'fall', style: '--x:73.4;--y:19.91;--w:1.52;--h:3.22' },
  { kind: 'fall', style: '--x:36.48;--y:24;--w:1.09;--h:2.05' },
  { kind: 'fall', style: '--x:59.72;--y:26.05;--w:1.3;--h:2.05' },
  { kind: 'fall', style: '--x:22.26;--y:47.13;--w:1.74;--h:3.63' },
  { kind: 'fall', style: '--x:80.13;--y:49.18;--w:1.95;--h:3.63' },
  { kind: 'fall', style: '--x:76;--y:53.86;--w:1.95;--h:4.68' },
  { kind: 'fall', style: '--x:69.06;--y:81.38;--w:1.52;--h:2.93' },
  { kind: 'glint', style: '--x:20.63;--y:91.33;--w:4.9;--d:3.8s' },
  { kind: 'glint', style: '--x:21.72;--y:93.68;--w:3.5;--d:4.4s;--dl:-1.6s' },
  { kind: 'glint', style: '--x:77.31;--y:91.92;--w:4.9;--d:4.1s;--dl:-2.2s' },
  { kind: 'glint', style: '--x:78.18;--y:94.26;--w:3.5;--d:3.5s;--dl:-.8s' },
]

/** The authored `--x:1;--y:2` strings become React style objects with custom properties. */
const custom_style = (declarations: string): CSSProperties =>
  Object.fromEntries(
    declarations.split(';').map((declaration) => {
      const [name, value] = declaration.split(':')
      return [name!, value!]
    })
  ) as CSSProperties

const Effects = ({ set, effects }: Readonly<{ set: 'd' | 'p'; effects: readonly Effect[] }>) => (
  <div className={`fx fx-${set}`}>
    {effects.map((effect, index) => (
      <i className={effect.kind} key={index} style={custom_style(effect.style)} />
    ))}
  </div>
)

export const LandingSurface = ({ assets }: Readonly<{ assets: LandingAssets }>) => (
  <>
    <svg aria-hidden="true" className="tone-defs" focusable="false" height="0" width="0">
      <filter colorInterpolationFilters="sRGB" id={LANDING_TONE_ID}>
        <feComponentTransfer>
          <feFuncR tableValues={TONE_TABLE} type="table" />
          <feFuncG tableValues={TONE_TABLE} type="table" />
          <feFuncB tableValues={TONE_TABLE} type="table" />
        </feComponentTransfer>
      </filter>
    </svg>
    <div aria-hidden="true" className="surface">
      <div className="pan" data-landing="pan">
        <picture>
          <source height="1708" media="(max-width:719px)" srcSet={assets.surface_phone} width="921" />
          <img
            alt=""
            data-landing="art"
            decoding="async"
            fetchPriority="high"
            height="1616"
            src={assets.surface_desktop}
            width="973"
          />
        </picture>
        <Effects effects={DESKTOP_EFFECTS} set="d" />
        <Effects effects={PHONE_EFFECTS} set="p" />
      </div>
    </div>
    <div aria-hidden="true" className="rain" data-landing="rain" />
    <div aria-hidden="true" className="wind" data-landing="wind" />
  </>
)
