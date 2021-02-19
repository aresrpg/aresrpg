export function block_position({ x, y, z }) {
  return {
    x: Math.floor(x),
    y: Math.floor(y),
    z: Math.floor(z),
  }
}

export function block_center_position({ x, y, z }) {
  return {
    x: Math.floor(x) + 0.5,
    y: Math.floor(y),
    z: Math.floor(z) + 0.5,
  }
}
