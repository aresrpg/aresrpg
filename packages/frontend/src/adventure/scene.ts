// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type scene_shape from '../../../../seed/scenes/adventure.json'

export const load_adventure_scene = async (
  signal: Readonly<AbortSignal>,
  request: (url: Readonly<URL>, options: Readonly<{ signal: Readonly<AbortSignal> }>) => Promise<Response> = fetch
): Promise<typeof scene_shape> => {
  const response = await request(new URL('../../../../seed/scenes/adventure.json', import.meta.url), { signal })
  if (!response.ok) throw new Error(`Adventure scenery request failed (${response.status}).`)
  return response.json() as Promise<typeof scene_shape>
}
