/**
 * Allows importing of a json data file while also passing a default fallback result
 * It is used to let AresRPG run even without needed an access to proprietary datas
 * @type {(path: string, fallback) => Promise<any>}
 */
function import_json(path, fallback) {
  return import(path, { assert: { type: 'json' } })
    .catch(() => ({ default: fallback }))
    .then(({ default: result }) => result)
}

export const Entities = await import_json('../data/entitiees.json', {})
export const Items = await import_json('..data/items.json', {})
export const Emotes = await import_json('..data/emotes.json', {})
