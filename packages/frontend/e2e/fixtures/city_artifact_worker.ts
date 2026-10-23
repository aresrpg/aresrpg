// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { probe_city_artifacts } from './city_artifact_probe.ts'
self.onmessage = () => {
  void probe_city_artifacts().then(
    (rows) => self.postMessage({ rows }),
    (error: unknown) => self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  )
}
