import vecmath from 'vecmath'

const { Vector3 } = vecmath

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

  for (let i = 0; i <= tubular_segments; i++) {
    for (let j = 0; j <= radial_segments; j++) {
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

export function rainbow_geometry({ min_radius, max_radius, sides, center }) {
  const vertices = []
  const steps = Math.PI / sides

  for (let a = 0; a < Math.PI; a += steps) {
    for (let radius = min_radius; radius < max_radius; radius += 0.1) {
      const position = new Vector3({
        x: center.x + Math.cos(a) * radius,
        y: center.y + Math.sin(a) * radius,
        z: center.z,
      })
      vertices.push(position)
    }
  }

  return {
    vertices,
    min_radius,
    max_radius,
    max_circles: Math.floor(vertices.length / sides),
    sides,
    center,
  }
}
