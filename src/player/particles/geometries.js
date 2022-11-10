import vecmath from 'vecmath'

const { Vector3 } = vecmath

export function circle_geometry({ radius, segments, center }) {
  const vertices = []
  for (let a = 0; a < 2 * Math.PI; a += (2 * Math.PI) / segments) {
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
    segments,
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

export function rainbow_geometry({ min_radius, max_radius, segments, center }) {
  const vertices = []
  const steps = Math.PI / segments

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
    max_circles: Math.floor(vertices.length / segments),
    segments,
    center,
  }
}

export function sphere_geometry({
  radius,
  height_segments,
  width_segments,
  phi_start = 0,
  phi_length = Math.PI * 2,
  theta_start = 0,
  theta_length = Math.PI,
}) {
  const vertices = []

  for (let iy = 0; iy < height_segments; iy++) {
    const v = iy / height_segments

    for (let ix = 0; ix <= width_segments; ix++) {
      const u = ix / width_segments

      vertices.push(
        new Vector3(
          -radius *
            Math.cos(phi_start + u * phi_length) *
            Math.sin(theta_start + v * theta_length),
          radius * Math.cos(theta_start + v * theta_length),
          radius *
            Math.sin(phi_start + u * phi_length) *
            Math.sin(theta_start + v * theta_length)
        )
      )
    }
  }

  return {
    radius,
    height_segments,
    width_segments,
    phi_start,
    phi_length,
    theta_start,
    theta_length,
    vertices,
  }
}

export function cube_geometry({
  width,
  height,
  depth,
  width_segments,
  height_segments,
  depth_segments,
}) {
  const vertices = []

  const build_plane = (
    u,
    v,
    w,
    udir,
    vdir,
    width,
    height,
    depth,
    gridX,
    gridY
  ) => {
    const segment_width = width / gridX
    const segment_height = height / gridY

    const width_half = width / 2
    const height_half = height / 2
    const depth_half = depth / 2

    const grid_x1 = gridX + 1
    const grid_y1 = gridY + 1

    for (let iy = 0; iy < grid_y1; iy++) {
      const y = iy * segment_height - height_half
      for (let ix = 0; ix < grid_x1; ix++) {
        const x = ix * segment_width - width_half
        vertices.push(
          new Vector3({
            [u]: x * udir,
            [v]: y * vdir,
            [w]: depth_half,
          })
        )
      }
    }
  }

  build_plane(
    'z',
    'y',
    'x',
    -1,
    -1,
    depth,
    height,
    width,
    depth_segments,
    height_segments
  )
  build_plane(
    'z',
    'y',
    'x',
    1,
    -1,
    depth,
    height,
    -width,
    depth_segments,
    height_segments
  )
  build_plane(
    'x',
    'z',
    'y',
    1,
    1,
    width,
    depth,
    height,
    width_segments,
    depth_segments
  )
  build_plane(
    'x',
    'z',
    'y',
    1,
    -1,
    width,
    depth,
    -height,
    width_segments,
    depth_segments
  )
  build_plane(
    'x',
    'y',
    'z',
    1,
    -1,
    width,
    height,
    depth,
    width_segments,
    height_segments
  )
  build_plane(
    'x',
    'y',
    'z',
    -1,
    -1,
    width,
    height,
    -depth,
    width_segments,
    height_segments
  )

  return {
    width,
    height,
    depth,
    width_segments,
    height_segments,
    depth_segments,
    vertices,
  }
}

export function line_geometry({ origin, direction, length, segments }) {
  const vertices = []

  const segment_width = length / segments

  for (let i = 0; i < segments; i++) {
    const len = i * segment_width

    vertices.push(
      new Vector3(
        origin.x + direction.x * len,
        origin.y + direction.y * len,
        origin.z + direction.z * len
      )
    )
  }

  return {
    vertices,
  }
}
