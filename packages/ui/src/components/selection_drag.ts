// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- This pointer-lifetime adapter creates, positions and removes its own disposable DOM clone. */
import type { SelectionPoint } from './selection_geometry.ts'

/** A disposable copy of the pressed cell follows the pointer above native windows. It owns no input. */
export const selection_drag_preview = (root: Readonly<HTMLElement>, item: string | null, point: SelectionPoint) => {
  const source = [...root.querySelectorAll<HTMLElement>('[data-selection-id]:not(:disabled)')].find(
    (cell) => cell.dataset.selectionId === item
  )
  if (!source) return null
  const bounds = source.getBoundingClientRect()
  const preview = document.createElement('div')
  preview.className = 'aui-selection-drag'
  preview.setAttribute('popover', 'manual')
  preview.setAttribute('aria-hidden', 'true')
  preview.setAttribute('inert', '')
  const cell = source.cloneNode(true) as HTMLElement
  for (const element of [cell, ...cell.querySelectorAll<HTMLElement>('*')]) {
    element.removeAttribute('id')
    element.removeAttribute('data-selection-id')
    element.removeAttribute('autofocus')
    element.setAttribute('tabindex', '-1')
  }
  cell.style.width = `${bounds.width}px`
  cell.style.height = `${bounds.height}px`
  preview.append(cell)
  root.append(preview)
  preview.showPopover()
  const move = ({ x, y }: SelectionPoint): void => {
    preview.style.left = `${x - bounds.width / 2}px`
    preview.style.top = `${y - bounds.height / 2}px`
  }
  move(point)
  return { move, remove: () => preview.remove() }
}
