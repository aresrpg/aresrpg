// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Matrix4, Quaternion, Vector3, type Object3D } from 'three'

/** Match authored contact frames without inheriting the pet's size or grounding the rider's feet. */
export const align_mount = (root: Object3D, rider: Object3D, seat: Object3D): void => {
  root.updateWorldMatrix(true, true)
  seat.updateWorldMatrix(true, false)
  const local = new Matrix4().copy(root.matrixWorld).invert().multiply(rider.matrixWorld)
  const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(local))
  root.quaternion.copy(seat.getWorldQuaternion(new Quaternion())).multiply(rotation.invert())
  const offset = new Vector3().setFromMatrixPosition(local).multiply(root.scale).applyQuaternion(root.quaternion)
  root.position.copy(seat.getWorldPosition(new Vector3())).sub(offset)
  root.updateMatrixWorld(true)
}
