import vecmath from 'vecmath'

const { Vector3, Matrix4 } = vecmath

export function circle_geometry({ radius, sides, center }) {
  const vertices = []
  for (let a = 0; a < 2 * Math.PI; a += (2 * Math.PI) / sides) {
    const position = new Vector3({
      x: center.x + Math.cos(a) * radius,
      y: center.y + Math.sin(a) * radius,
      z: center.z,
    })
    vertices.push(position)
  }
  return {
    vertices,
    radius,
    sides,
    center,
  }
}

export function torus_geometry({
  radius,
  tube,
  center,
  radial_segments,
  tubular_segments,
}) {
  const vertices = []

  for (let j = 0; j <= radial_segments; j++) {
    for (let i = 0; i <= tubular_segments; i++) {
      const u = (i / tubular_segments) * Math.PI * 2
      const v = (j / radial_segments) * Math.PI * 2

      vertices.push(
        new Vector3(
          (radius + tube * Math.cos(v)) * Math.cos(u),
          (radius + tube * Math.cos(v)) * Math.sin(u),
          tube * Math.sin(v)
        )
      )
    }
  }

  return {
    vertices,
    radius,
    tube,
    radial_segments,
    tubular_segments,
    center,
  }
}

export function rainbow_torus_material() {}

export function updateTransformMatrix(mesh) {
  const { position, rotation, scale } = mesh

  const m_translate = new Matrix4().identity().translate(position)
  const m_rotate = new Matrix4()
    .rotate(rotation.x, new Vector3(1, 0, 0))
    .multiply(new Matrix4().rotate(rotation.y, new Vector3(0, 1, 0)))
    .multiply(new Matrix4().rotate(rotation.z, new Vector3(0, 0, 1)))
  const m_scale = new Matrix4().identity().scale(scale)

  mesh.transformMatrix = m_translate
    .clone()
    .multiply(m_rotate)
    .multiply(m_scale)
}

export function mesh({ geometry, material, position, rotation, scale }) {
  const transformMatrix = new Matrix4().identity()

  return {
    geometry,
    material,
    position,
    rotation,
    scale,
    transformMatrix,
  }
}
