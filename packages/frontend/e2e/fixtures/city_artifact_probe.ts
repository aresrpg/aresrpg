// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { CITY_DEFINITIONS, read_city_artifact } from '../../../engine/src/cities/registry.ts'

/** Exercise the real city readers and URL rewriting, in both window and worker bundles. */
export const probe_city_artifacts = async () =>
  Promise.all(
    CITY_DEFINITIONS.filter(({ id }) => ['the_ruins', 'fuwage'].includes(id)).map(async (definition) => {
      const urls = [definition.artifact_url, definition.details_url]
      const artifacts = await Promise.all(urls.map((url) => read_city_artifact(definition, url)))
      return { id: definition.id, urls: urls.map((url) => url.href), loaded: artifacts.map((artifact) => artifact.id) }
    })
  )
export type CityProbe = Awaited<ReturnType<typeof probe_city_artifacts>>
