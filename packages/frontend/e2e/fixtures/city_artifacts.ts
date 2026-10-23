// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { probe_city_artifacts, type CityProbe } from './city_artifact_probe.ts'

declare global {
  interface Window {
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
