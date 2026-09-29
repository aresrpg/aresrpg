// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { canopy_lighting_probe } from '../../../engine/test/browser_canopy_lighting.ts'

const probe = await canopy_lighting_probe(document.querySelector('canvas')!)
declare global {
  interface Window {
    canopy_lighting: typeof probe
  }
}
window.canopy_lighting = probe
window.addEventListener('pagehide', probe.dispose, { once: true })
