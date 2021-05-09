import vecmath from 'vecmath'

const { Matrix4, Vector3 } = vecmath

export const ParticlesTypes = {
  RGB: 14,
}

export function spawn_particle(
  client,
  { particle_id, position: { x, y, z }, data, particles = 1 }
) {
  console.log(data)
  client.write('world_particles', {
    particleId: particle_id,
    longDistance: false,
    x,
    y,
    z,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
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
    transformMatrix: new Matrix4().identity(),
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
}

export function render_particles(client, vertices) {
  vertices
    .filter(({ properties: { visible } }) => visible)
    .forEach(({ vertice, properties }) => {
      spawn_particle(client, { position: vertice, ...properties })
    })
}
