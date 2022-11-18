import vecmath from 'vecmath'

const { Matrix4, Vector3 } = vecmath

export const ParticlesTypes = {
  AMBIENT_ENTITY: 0,
  ANGRY: 1,
  BARRIER: 2,
  WATER_BUBBLE: 4,
  HIT: 6,
  BLACK_HEARTS: 7,
  DRAGON_BREATH: 8,
  LAVA: 9,
  LAVA_DRIP: 11,
  WATER_DRIP: 12,
  RAIN: 13,
  RGB: 14,
  POTION: 15,
  ELDER_GUARDIAN: 16,
  CRITICAL_HIT: 17,
  ENCHANTING: 18,
  WHITE_BALL: 19,
  POTION2: 20,
  BIG_EXPLOSION: 21,
  EXPLOSION: 22,
  DARK_PARTICLES: 23,
  SPARK: 24,
  WATER_SPLASH: 25,
  FIRE: 26,
  SOUL_FIRE: 27,
  SOUL: 28,
  DRAGON_EXPLOSION: 29,
  GREEN_SPARK: 30,
  FAST_GREEN_SPARK: 31,
  RED_HEARTS: 32,
  FAST_SPARK: 33,
  CRASH_THE_GAME: 34,
  SLIME: 35,
  SNOW: 36,
  BIG_SMOKE: 37,
  FIRE_SPRAY: 38,
  SMOKE: 39,
  NOTE: 40,
  WHITE_SMOKE: 41,
  PURPLE_LIGHT_PARTICLE: 42,
  WATER_SPLASH2: 43,
  MEDIUM_SMOKE: 44,
  TRANSPARENT_BLUE_SMOKE: 45,
  FALLING_SAND: 46,
  DARK_SMOKE: 47,
  SWORD_SLASH: 48,
  GREEN_BALL: 49,
  PURPLE_SPARK: 52,
  WATER_BUBBLE_SPLASH: 53,
  CONDUIT: 56,
  UNDER_WATER_PARTICLE: 57,
  FIRE_CAMP_SMOKE: 58,
  HONEY: 60, // Make Noise
  FAST_HONEY: 62,
  BEDROCK_PARTICLE: 64,
  UPWARD_RED_PARTICLES: 65,
  UPWARD_DARK_PARTICLES: 66,
  FALLING_PURPLE_PARTICLE: 68,
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
      mesh.material.colorize_vertice(mesh.geometry, vertice, index)
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
