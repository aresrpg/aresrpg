// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { render_grain_gallery } from '../../../engine/test/browser_grains.ts'

const icons = import.meta.glob('../../../../seed/icons/items/*_hd.png', {
  eager: true,
  query: '?url',
  import: 'default',
})
const rows = render_grain_gallery(document.getElementById('canvas') as HTMLCanvasElement)
rows.forEach(({ item_type, x, y }) => {
  const label = document.createElement('div')
  label.textContent = item_type
  label.style.cssText = `position:absolute;left:${x + 8}px;top:${y + 305}px`
  document.body.append(label)
  const icon = document.createElement('img')
  icon.src = icons[`../../../../seed/icons/items/${item_type}_hd.png`] as string
  icon.style.cssText = `position:absolute;left:${x + 225}px;top:${y + 8}px;width:65px;height:65px`
  document.body.append(icon)
})
document.body.dataset.ready = 'true'
