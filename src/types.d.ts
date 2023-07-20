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
  k: infer I,
) => void
  ? I
  : never

type Await<T> = T extends Promise<infer U> ? U : T

type ItemBase = {
  name: string
  type: string
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
  damage?: {
    from: number
    to: number
    type: string
    element: string
  }[]
}

type ItemStatisticsTemplate = {
  vitality: number[]
  mind: number[]
  strength: number[]
  intelligence: number[]
  chance: number[]
  agility: number[]
  speed: number[]
  reach: number[]
  haste: number[]
}

type ItemStatistics = {
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

/** An item template is a static json object representing the schema of an item,
 * it is used to generate real items
 */
type ItemTemplate = ItemBase & {
  stats?: ItemStatisticsTemplate
}

/** Represent an item ready to be used, it has fixed stats and a count */
type Item = ItemBase & {
  stats?: ItemStatistics
  count: number
}
