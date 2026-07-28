// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Big-map zone delimiters + names. Geometry arrives from @aresrpg/world and the caller supplies the map's
// established world→canvas projection; this renderer owns presentation only.

const zone_edge_rows = (zones) =>
  zones.flatMap(({ bounds }) => [
    [bounds.min_x, bounds.min_z, bounds.max_x, bounds.min_z],
    [bounds.max_x, bounds.min_z, bounds.max_x, bounds.max_z],
    [bounds.min_x, bounds.max_z, bounds.max_x, bounds.max_z],
    [bounds.min_x, bounds.min_z, bounds.min_x, bounds.max_z],
  ])

const unique_zone_edges = (zones) => [...new Map(zone_edge_rows(zones).map((edge) => [edge.join(':'), edge])).values()]

const label_boxes_overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

const draw_zone_delimiters = (ctx, zones, to_screen) => {
  ctx.save()
  ctx.beginPath()
  for (const [x1, z1, x2, z2] of unique_zone_edges(zones)) {
    const start = to_screen(x1, z1)
    const end = to_screen(x2, z2)
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
  }
  ctx.strokeStyle = 'rgba(200, 150, 60, 0.38)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()
}

const draw_zone_labels = (ctx, zones, to_screen, view) => {
  const occupied = []
  ctx.save()
  ctx.font = "600 9px 'JetBrains Mono', monospace"
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const zone of zones) {
    const { bounds } = zone
    const label = String(zone.label ?? zone.id).toUpperCase()
    const point = to_screen((bounds.min_x + bounds.max_x) / 2, (bounds.min_z + bounds.max_z) / 2)
    const text_width = Math.ceil(ctx.measureText(label).width)
    const width = text_width + 12
    const height = 16
    const box = {
      left: point.x - width / 2,
      right: point.x + width / 2,
      top: point.y - height / 2,
      bottom: point.y + height / 2,
    }
    const zone_width = Math.abs(bounds.max_x - bounds.min_x) * view.ppb
    const zone_height = Math.abs(bounds.max_z - bounds.min_z) * view.ppb
    const fits_zone = width + 20 <= zone_width && height + 20 <= zone_height
    const fits_view = box.left >= 4 && box.right <= view.size - 4 && box.top >= 4 && box.bottom <= view.size - 4
    const occluded = occupied.some((placed) => label_boxes_overlap(placed, box))
    if (!fits_zone || !fits_view || occluded) continue
    ctx.fillStyle = 'rgba(7, 9, 13, 0.78)'
    ctx.fillRect(box.left, box.top, width, height)
    ctx.fillStyle = '#f5d0a9'
    ctx.fillText(label, point.x, point.y + 0.5)
    occupied.push(box)
  }
  ctx.restore()
}

/**
 * Draw thin shared boundaries and centered uppercase micro-labels for canonical zone rectangles. Labels are
 * hidden when they cannot fit inside their projected zone/view or when they would overlap an accepted label.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{id:string,label?:string,bounds:{min_x:number,min_z:number,max_x:number,max_z:number}}>} zones
 * @param {(world_x:number, world_z:number) => {x:number,y:number}} to_screen the big map's existing projection
 * @param {{size:number,ppb:number}} view
 * @returns {void}
 */
export function draw_zone_map_overlay(ctx, zones, to_screen, view) {
  if (!zones?.length) return
  draw_zone_delimiters(ctx, zones, to_screen)
  draw_zone_labels(ctx, zones, to_screen, view)
}
