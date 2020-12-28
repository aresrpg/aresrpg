export function set_world_border({ client, radius }) {
  client.write('world_border', { action: 0, radius })
  client.write('world_border', { action: 2, x: 0, z: 0 })
}

export function red_screen({ client, warning_blocks }) {
  client.write('world_border', { action: 5, warning_blocks })
}
