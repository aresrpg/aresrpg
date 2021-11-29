import entity_metadata from './entity_metadata.json'

export const villager_types = {
  DESERT: 0,
  JUNGLE: 1,
  PLAINS: 2,
  SAVANNA: 3,
  SNOW: 4,
  SWAMP: 5,
  TAIGA: 6,
}

export const villager_professions = {
  NONE: 0,
  ARMORE: 1,
  BUTCHER: 2,
  CARTOGRAPHER: 3,
  CLERIC: 4,
  FARMER: 5,
  FISHERMAN: 6,
  FLETCHER: 7,
  LEATHERWORKER: 8,
  LIBRARIAN: 9,
  MASON: 10,
  NITWIT: 11,
  SHEPERD: 12,
  TOOLSMITH: 13,
  WEAPONSMITH: 14,
}

function to_bitmask(bitflags, object) {
  return Object.entries(bitflags).reduce(
    (result, [name, value]) => result | (object[name] << value),
    0
  )
}

export function to_metadata(entity, metadatas) {
  const meta_entity = entity_metadata[entity]
  if (!meta_entity) throw new Error(`${entity} is not a valid entity`)

  const known = Object.entries(metadatas).filter(
    ([name]) => name in meta_entity.metadata
  )
  const leftover = Object.entries(metadatas).filter(
    ([name]) => !(name in meta_entity.metadata)
  )

  if (!meta_entity.parent && leftover.length !== 0)
    throw new Error(`unknown keys: ${leftover.map(([key]) => key)}`)

  return known
    .map(([meta_name, meta_value]) => {
      const { key, type, bitflags } = meta_entity.metadata[meta_name]
      return {
        key,
        type,
        value: bitflags ? to_bitmask(bitflags, meta_value) : meta_value,
      }
    })
    .concat(
      meta_entity.parent
        ? to_metadata(meta_entity.parent, Object.fromEntries(leftover))
        : []
    )
}
