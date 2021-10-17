import Vec3 from 'vec3'

export function is_inside({ min, max }, { x, y }) {
  return x >= min.x && x <= max.x && y >= min.y && y <= max.y
}

/**
 * Get the symmetric difference of two squares of the same size
 *
 * +--------+
 * | a      |
 * |   +--------+
 * |   | c  |   |
 * +--------+   |
 *     |      b |
 *     +--------+
 *
 * So here the area a and b but not c
 *
 * @param {Object} $0
 * @param {number} $0.x x coordinate of the first square's center
 * @param {number} $0.y y coordinate of the first square's center
 * @param {Object} $1
 * @param {number} $1.x x coordinate of the second square's center
 * @param {number} $1.y y coordinate of the second square's center
 * @param {number} demi_length 1/2 of the length of the square
 * @return {{ a: Array<{ x, y }>, b: Array<{ x, y }> }} points in a and in b
 */
export function square_symmetric_difference(
  { x: ax, y: ay },
  { x: bx, y: by },
  demi_length
) {
  const a = []
  const b = []

  const is_inside_a = is_inside.bind(null, {
    min: { x: ax - demi_length, y: ay - demi_length },
    max: { x: ax + demi_length, y: ay + demi_length },
  })
  const is_inside_b = is_inside.bind(null, {
    min: { x: bx - demi_length, y: by - demi_length },
    max: { x: bx + demi_length, y: by + demi_length },
  })

  for (let x = -demi_length; x <= demi_length; x++) {
    for (let y = -demi_length; y <= demi_length; y++) {
      const a_point = { x: ax + x, y: ay + y }
      const b_point = { x: bx + x, y: by + y }

      if (!is_inside_b(a_point)) a.push(a_point)
      if (!is_inside_a(b_point)) b.push(b_point)
    }
  }
  return { a, b }
}

/**
 * Get the points in the difference between two square with same center
 *
 * +-----------+
 * | a         |
 * |   +---+   |
 * |   | b |   |
 * |   +---+   |
 * |         a |
 * +-----------+
 */
export function square_difference(
  { x: cx, y: cy },
  demi_length_a,
  demi_length_b
) {
  const from = Math.min(demi_length_a, demi_length_b)
  const to = Math.max(demi_length_a, demi_length_b)
  const is_inside_from = is_inside.bind(null, {
    min: { x: -from, y: -from },
    max: { x: from, y: from },
  })

  const res = []

  for (let x = -to; x <= to; x++) {
    for (let y = -to; y <= to; y++) {
      if (!is_inside_from({ x, y })) res.push({ x: cx + x, y: cy + y })
    }
  }

  return res
}

export function distance2d_squared({ x: ax, y: ay }, { x: bx, y: by }) {
  return (ax - bx) ** 2 + (ay - by) ** 2
}

export function distance3d_squared(
  { x: ax, y: ay, z: az },
  { x: bx, y: by, z: bz }
) {
  return (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2
}

export function sort_by_distance2d(center, positions) {
  return positions.slice(0).sort((a, b) => {
    return distance2d_squared(center, a) - distance2d_squared(center, b)
  })
}

export function to_direction(yaw, pitch) {
  const yaw_rad = yaw * (Math.PI / 180)
  const pitch_rad = pitch * (Math.PI / 180)
  const xz = Math.cos(pitch_rad)
  return Vec3([
    -xz * Math.sin(yaw_rad),
    -Math.sin(pitch_rad),
    xz * Math.cos(yaw_rad),
  ])
}

export function floor_pos(position) {
  return {
    x: Math.floor(position.x),
    y: Math.floor(position.y),
    z: Math.floor(position.z),
  }
}

export function intersect_ray_plane(origin, direction, normal, dist) {
  const denom = direction.dot(normal)
  if (denom !== 0) {
    const t = -(origin.dot(normal) + dist) / denom
    if (t < 0) {
      return null
    }
    return origin.add(direction.scaled(t))
  } else if (normal.dot(origin) + dist === 0) {
    return origin
  } else {
    return null
  }
}

export function direction_to_yaw_pitch(direction) {
  const distance = Math.sqrt(direction.x ** 2 + direction.z ** 2)
  const pitch = Math.floor(
    (-Math.atan2(direction.y, distance) / Math.PI) * (255 / 2)
  )
  const yaw = Math.floor(
    (-Math.atan2(direction.x, direction.z) / Math.PI) * (255 / 2)
  )

  return {
    yaw,
    pitch,
  }
}
