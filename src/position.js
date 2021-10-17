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

export const position_equal = (a, b) =>
  a?.x === b?.x && a?.y === b?.y && a?.z === b?.z

export const block_position_equal = (a, b) =>
  Math.floor(a?.x) === Math.floor(b?.x) &&
  Math.floor(a?.y) === Math.floor(b?.y) &&
  Math.floor(a?.z) === Math.floor(b?.z)
