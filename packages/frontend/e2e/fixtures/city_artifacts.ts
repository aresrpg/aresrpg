// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { terrain_failure } from '../../../engine/src/asset_error.ts'
import type { EngineIssue } from '../../../engine/src/types.ts'
import { CITY_DEFINITIONS, read_city_artifact } from '../../../engine/src/cities/registry.ts'
import { read_worker_error, worker_error } from '../../../engine/src/worker_reply.ts'

import { probe_city_artifacts, type CityProbe } from './city_artifact_probe.ts'

declare global {
  interface Window {
    probe_city_failure: (status: number) => Promise<EngineIssue | null>
    probe_cities: () => Promise<{ main: CityProbe; worker: CityProbe }>
  }
}
window.probe_cities = async () => {
  const main = await probe_city_artifacts()
  const worker = new Worker(new URL('./city_artifact_worker.ts', import.meta.url), { type: 'module' })
  try {
    const rows = await new Promise<CityProbe>((resolve, reject) => {
      worker.onmessage = ({ data }: { data: { rows?: CityProbe; error?: string } }) =>
        data.error ? reject(new Error(data.error)) : resolve(data.rows!)
      worker.onerror = (event) => reject(new Error(event.message))
      worker.postMessage(null)
    })
    return { main, worker: rows }
  } finally {
    worker.terminate()
  }
}

window.probe_city_failure = async (status) => {
  try {
    await read_city_artifact(CITY_DEFINITIONS[0]!, new URL(`/assets/failure-${status}.json`, location.href))
    return null
  } catch (error) {
    return terrain_failure(read_worker_error(structuredClone(worker_error(error))))
  }
}
