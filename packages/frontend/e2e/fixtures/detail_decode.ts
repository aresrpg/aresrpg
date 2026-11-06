// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { decode_detail_cell, DETAIL_STRIDE } from '../../../engine/src/detail_artifact.ts'
import { get_quality_profile } from '../../../engine/src/quality.ts'
import { detail_triangle } from '../../../engine/test/fixtures/detail_triangle.ts'

const measure_details = async () => {
  const bytes = get_quality_profile('low').chunks.upload_bytes_per_frame
  const triangles = Math.floor(bytes / (DETAIL_STRIDE * 3 * 4))
  const cell = { ...detail_triangle, vertices: detail_triangle.vertices.repeat(triangles) }
  const durations: number[] = []
  for (let index = 0; index < 30; index++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    const start = performance.now()
    const values = decode_detail_cell(cell)
    durations.push(performance.now() - start)
    if (values.length !== triangles * DETAIL_STRIDE * 3) throw new Error('Incomplete detail admission')
  }
  return { durations, budget: get_quality_profile('medium').chunks.upload_time_ms }
}
declare global {
  interface Window {
    measure_details: typeof measure_details
  }
}
window.measure_details = measure_details
