// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { probe_captions } from '../../../engine/test/browser_captions.ts'
import '../../src/tailwind.css'

declare global {
  interface Window {
    probe_captions: (kind: 'grid' | 'webgpu') => ReturnType<typeof probe_captions>
  }
}
window.probe_captions = (kind) => probe_captions(document.querySelector('canvas')!, kind)
