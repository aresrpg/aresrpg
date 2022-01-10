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
  if (!(entity in entity_metadata))
    throw new Error(`${entity} doesn't have any metadata`)
  const { parent, metadata } = entity_metadata[entity]
  const known = Object.entries(metadatas).filter(([name]) => name in metadata)
  const leftover = Object.entries(metadatas).filter(
    ([name]) => !(name in metadata)
  )

  if (!parent && leftover.length !== 0)
    throw new Error(`unknown keys: ${leftover.map(([key]) => key)}`)

  return known
    .map(([meta_name, meta_value]) => {
      const { key, type, bitflags } = metadata[meta_name]
      return {
        key,
        type,
        value: bitflags ? to_bitmask(bitflags, meta_value) : meta_value,
      }
    })
    .concat(parent ? to_metadata(parent, Object.fromEntries(leftover)) : [])
}
