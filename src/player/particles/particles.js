import vecmath from 'vecmath'

const { Matrix4, Vector3 } = vecmath

export const ParticlesTypes = {
  AMBIENT_ENTITY: 0,
  ANGRY_VILLAGER: 1,
  BLOCK: 2, // Default: Barrier
  BLOCK_MARKER: 3, 
  WATER_BUBBLE: 4,
  CLOUD: 5,
  CRIT: 6,
  DAMAGE_INDICATOR: 7,
  DRAGON_BREATH: 8,
  DRIPPING_LAVA: 9,
  FALLING_LAVA: 10,
  LANDING_LAVA: 11,
  DRIPPING_WATER: 12,
  FALLING_WATER: 13,
  RGB: 14,
  POTION: 15,
  ELDER_GUARDIAN: 16,
  ENCHANTED_HIT: 17,
  ENCHANT: 18,
  END_ROD: 19,
  ENTITY_EFFECT: 20,
  BIG_EXPLOSION: 21,
  EXPLOSION: 22,
  FALLING_DUST: 23,
  FIREWORK: 24,
  FISHING: 25,
  FLAME: 26,
  SOUL_FLAME: 27,
  SOUL: 28,
  DRAGON_FLASH: 29,
  HAPPY_VILLAGER: 30,
  COMPOSTER: 31,
  HEART: 32,
  INSTANT_EFFECT: 33,
  ITEM: 34,
  SLIME: 35,
  SNOW: 36,
  BIG_SMOKE: 37,
  LAVA: 38,
  MYCELIUM: 39,
  NOTE: 40,
  WHITE_SMOKE: 41,
  PORTAL: 42,
  RAIN: 43,
  SMOKE: 44,
  SNEEZE: 45,
  SPIT: 46,
  INK: 47,
  SWEEP: 48,
  GREEN_BALL: 49,
  UNDERWATER: 50,
  SPLASH: 51,
  WITCH: 52,
  BUBBLE_POP: 53,
  CURRENT_DOWN: 54,
  BUBBLE_COLUMN_UP: 55,
  NAUTILUS: 56,
  DOLPHIN: 57,
  CAMP_FIRE_SMOKE: 58,
  CAMP_FIRE_SIGNAL: 59,
  DRIPPING_HONEY: 60,
  FALLING_HONEY: 61, // Make Noise
  LANDING_HONEY: 62,
  FALLING_NECTAR: 63,
  FALLING_SPORE: 64,
  ASH: 65,
  CRIMSON_SPORE: 66,
  WARPED_SPORE: 67,
  SPORE_AIR: 68,
  FAST_FALLING_PURPLE_PARTICLE: 69,
  SMALL_PURPLE_PARTICLE: 70,
  SNOW_POWDER: 71,
  FAST_BARRIER: 72,
}

export function spawn_particle(
  client,
  {
    particle_id,
    position: { x, y, z },
    data,
    particles = 1,
    long_distance = true,
    offset = { offsetX: 0, offsetY: 0, offsetZ: 0 },
  }
) {
  client.write('world_particles', {
    particleId: particle_id,
    longDistance: long_distance,
    x,
    y,
    z,
    ...offset,
    particles,
    particleData: 0, // IDK WHAT IT DOES
    data,
  })
}

export function mesh({ geometry, material, position, rotation, scale }) {
  return {
    geometry,
    material,
    position,
    rotation,
    scale,

    // avoid computing everyting every "frame"
    transformMatrix: updateTransformMatrix({ position, rotation, scale })
      .transformMatrix,
    vertices_dirty: true,
    properties_dirty: true,
    transformed_vertices: [],
    transformed_properies: [],
  }
}

export function updateTransformMatrix(mesh) {
  const { position, rotation, scale } = mesh

  const m_translate = new Matrix4().identity().translate(position)
  // TODO: quaternions maybe ?
  const m_rotate = new Matrix4()
    .rotate(rotation.x, new Vector3(1, 0, 0))
    .multiply(new Matrix4().rotate(rotation.y, new Vector3(0, 1, 0)))
    .multiply(new Matrix4().rotate(rotation.z, new Vector3(0, 0, 1)))
  const m_scale = new Matrix4().identity().scale(scale)

  mesh.transformMatrix = m_translate
    .clone()
    .multiply(m_rotate)
    .multiply(m_scale)
  mesh.vertices_dirty = true
  return mesh
}

export function updateMaterial(mesh, material) {
  mesh.material = material
  mesh.properties_dirty = true
}

export function render_mesh(mesh) {
  // avoid re transfrom all the points if nothing has changed
  if (mesh.vertices_dirty) {
    mesh.vertices_dirty = false
    mesh.transformed_vertices = mesh.geometry.vertices.map(vertice =>
      vertice.clone().transformMat4(mesh.transformMatrix)
    )
  }

  // avoid re transfrom all the colors/properties if nothing has changed
  if (mesh.properties_dirty) {
    mesh.properties_dirty = false
    mesh.transformed_properies = mesh.geometry.vertices.map((vertice, index) =>
      mesh.material.colorize_vertice({geometry: mesh.geometry, vertice, index})
    )
  }

  return mesh.geometry.vertices.map((v, index) => ({
    vertice: mesh.transformed_vertices[index],
    properties: mesh.transformed_properies[index],
  }))
}

export function render_particles(client, vertex) {
  if (vertex === undefined) return
  vertex
    .filter(({ properties: { visible } }) => visible)
    .forEach(({ vertice, properties }) => {
      spawn_particle(client, { position: vertice, ...properties })
    })
}
