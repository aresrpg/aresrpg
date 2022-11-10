import vecmath from 'vecmath'

const { Matrix4, Vector3 } = vecmath

export const ParticlesTypes = {
  RGB: 14,
}

export function spawn_particle(
  client,
  {
    particle_id,
    position: { x, y, z },
    data,
    particles = 1,
    long_distance = false,
  }
) {
  client.write('world_particles', {
    particleId: particle_id,
    longDistance: long_distance,
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
  vertex
    .filter(({ properties: { visible } }) => visible)
    .forEach(({ vertice, properties }) => {
      spawn_particle(client, { position: vertice, ...properties })
    })
}
