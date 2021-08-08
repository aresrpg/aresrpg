import net from 'net'

declare module 'minecraft-protocol' {
  interface ServerOptions {
    favicon: string
  }

  interface Server {
    socketServer: net.Server
  }

  interface Client {
    id: number
    end(reason: string, fullReason: string): void
  }
}

declare module 'minecraft-data' {
  interface IndexedData {
    loginPacket: any
  }
}

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I
) => void
  ? I
  : never
