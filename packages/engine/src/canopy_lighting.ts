// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { PhysicalLightingModel, type Node, type NodeBuilder } from 'three/webgpu'

/** Average internal canopy shading attenuates direct light; it never overrides an external shadow. */
export const canopy_light_visibility = (sun_shadow: number): number => 0.5 * Math.max(0, Math.min(1, sun_shadow))

/** A diffuse-only leaf basis must not feed the physical grazing-angle reflection lobe. */
export class CanopyLightingModel extends PhysicalLightingModel {
  constructor(private readonly specular_weight: Node<'float'>) {
    super()
  }

  override start(builder: NodeBuilder): void {
    super.start(builder)
    const { reflectedLight: reflected } = builder.context as {
      reflectedLight: {
        directSpecular: Node<'vec3'>
        indirectSpecular: Node<'vec3'>
      }
    }
    reflected.directSpecular.mulAssign(this.specular_weight)
    reflected.indirectSpecular.mulAssign(this.specular_weight)
  }
}
