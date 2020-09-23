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
 * @param {number} $0.x x coordinate of the first square's center
 * @param {number} $0.y y coordinate of the first square's center
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

  demi_length -= 1

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
  const from = Math.min(demi_length_a, demi_length_b) - 1
  const to = Math.max(demi_length_a, demi_length_b) - 1
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

export function distance_squared({ x: ax, y: ay }, { x: bx, y: by }) {
  return (ax - bx) ** 2 + (ay - by) ** 2
}

export function sort_by_distance(center, positions) {
  return positions.slice(0).sort((a, b) => {
    return distance_squared(center, a) - distance_squared(center, b)
  })
}
