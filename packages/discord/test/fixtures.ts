import type { Notification } from '../src/notification.ts'

export const address = `0x${'a'.repeat(64)}`
const base = { id: '1:0:0:event', digest: '1'.repeat(44), ts_ms: 1000 }

export const examples: readonly Notification[] = [
  {
    ...base,
    kind: 'sale',
    asset_kind: 'item',
    seller: address,
    name: 'Gnawed Branch',
    item_type: 'gnawed_branch',
    amount: 10,
    price_mist: '2500000000',
  },
  { ...base, kind: 'gather', address, item_type: 'golden_wheat', world: 'nauvis' },
  {
    ...base,
    kind: 'victory',
    fight: address,
    dungeon: 'gilded_lorito',
    winners: [address],
    mob_types: ['nook', 'golden_lorito'],
  },
  {
    ...base,
    kind: 'loot',
    address,
    object: address,
    item_type: 'lorito_hat__golden',
    name: 'Golden Lorito Hood',
    category: 'hat',
    level: 16,
    stats: { vitality: 49, intelligence: 48, critical: 2 },
  },
]
