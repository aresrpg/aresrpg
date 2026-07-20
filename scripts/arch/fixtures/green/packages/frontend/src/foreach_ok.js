// GREEN fixture — held promises: sequential for..of await, and Promise.all over map(async …).
export const save_sequential = async (items, save_item) => {
  for (const item of items) await save_item(item)
}

export const save_parallel = async (items, save_item) => Promise.all(items.map(async (item) => save_item(item)))
