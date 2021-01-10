export const Actions = {
  SET_RADIUS: 0, // Set the world border radius
  LERP_RADIUS: 1, // Set the world border radius in x seconds with a slide animation
  SET_CENTER: 2, // Set the world border position
  INIT: 3, // Do all others actions at same times
  SET_WARNING_TIME: 4, // i don't know (default : 0)
  SET_WARNING_BLOCKS: 5, // Set the warning distance in block meters before screen turn to red (default : 0)
}

export function set_world_border({ client, x, z, radius, speed }) {
  client.write('world_border', {
    action: Actions.INIT,
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
  client.write('world_border', {
    action: Actions.SET_WARNING_BLOCKS,
    warning_blocks: 5000,
  })
}

export function normal_screen({ client }) {
  client.write('world_border', {
    action: Actions.SET_WARNING_BLOCKS,
    warning_blocks: 0,
  })
}
