export function set_world_border({ client, x, z, radius, speed }) {
  client.write('world_border', {
    action: 3,
    x,
    z,
    old_radius: radius,
    new_radius: radius,
    speed,
    portalBoundary: 29999984,
    warning_time: 0,
    warning_blocks: 0,
  })
}

export function red_screen({ client }) {
  client.write('world_border', { action: 5, warning_blocks: 5000 })
}

export function normal_screen({ client }) {
  client.write('world_border', { action: 5, warning_blocks: 0 })
}
