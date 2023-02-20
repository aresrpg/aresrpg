import net from 'net'

declare module 'minecraft-protocol' {
  interface Server {
    socketServer: net.Server
  }

  interface Client {
    id: number
    write(packet: string, payload: any): void
    end(reason: string, fullReason: string): void
  }
}

declare module 'minecraft-data' {
  interface IndexedData {
    loginPacket: LoginPacket
  }
}

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I
) => void
  ? I
  : never

type Await<T> = T extends Promise<infer U> ? U : T

type ItemBase = {
  name: string
  type:
    | 'helmet'
    | 'chestplate'
    | 'leggings'
    | 'boots'
    | 'necklace'
    | 'ring'
    | 'belt'
    | 'shield'
    | 'sword'
    | 'axe'
    | 'bow'
    | 'stick'
    | 'misc'
    | 'consumable'
  item: string
  custom_model_data: number
  enchanted: boolean
  description: string
  level: number
  critical:
    | {
        outcomes: number
        bonus: number
      }
    | undefined
  damage: {
    from: number
    to: number
    type: 'damage' | 'life_steal' | 'heal'
    element: 'earth' | 'fire' | 'water' | 'air'
  }[]
}

/** An item template is a static json object representing the schema of an item,
 * it is used to generate real items
 */
type ItemTemplate = ItemBase & {
  stats:
    | {
        vitality: [number, number]
        mind: [number, number]
        strength: [number, number]
        intelligence: [number, number]
        chance: [number, number]
        agility: [number, number]
        speed: [number, number]
        reach: [number, number]
        haste: [number, number]
      }
    | undefined
}

/** Represent an item ready to be used, it has fixed stats and a count */
type Item = ItemBase & {
  stats: {
    vitality: number | undefined
    mind: number | undefined
    strength: number | undefined
    intelligence: number | undefined
    chance: number | undefined
    agility: number | undefined
    speed: number | undefined
    reach: number | undefined
    haste: number | undefined
  }
  count: number
}
