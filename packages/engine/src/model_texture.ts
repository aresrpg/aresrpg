// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shared sampling policy for the deliberately low-resolution textures used by all rendered entities.

import { LinearMipmapLinearFilter, NearestFilter, type Texture } from 'three'

export const prepare_pixel_texture = (texture: Texture): void => {
  texture.magFilter = NearestFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8
  texture.needsUpdate = true
}
