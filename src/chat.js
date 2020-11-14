export const Position = {
  CHAT: 0, // appears in the chat box
  SYSTEM_MESSAGE: 1, // appears in the chat box
  GAME_INFO: 2, // appears above the hotbar
}

export function write_chat_msg(
  { server: { clients } },
  { message, client: { uuid } }
) {
  const options = {
    message: message,
    position: Position.CHAT,
    sender: uuid,
  }
  const send_packet = (client) => client.write('chat', options)
  Object.values(clients).forEach(send_packet)
}

export default function chat({ server, client }) {
  client.on('chat', (packet) => {
    const message = {
      translate: 'chat.type.text',
      with: [
        {
          text: client.username,
        },
        {
          text: packet.message,
        },
      ],
    }

    write_chat_msg({ server }, { message: JSON.stringify(message), client })
  })
}
