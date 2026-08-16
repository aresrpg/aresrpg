// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The one parsed-GLB cache and Draco decoder used by every entity model family.
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'

const draco = new DRACOLoader()
const loader = new GLTFLoader().setDRACOLoader(draco)
const sources = new Map<string, Promise<GLTF>>()

export const load_gltf_source = (url: string): Promise<GLTF> => {
  const cached = sources.get(url)
  if (cached) return cached
  const pending = loader.loadAsync(url)
  sources.set(url, pending)
  void pending.catch((error: unknown) => {
    if (sources.get(url) === pending) sources.delete(url)
    console.error(`Failed to load entity model source ${url}.`, error)
  })
  return pending
}
