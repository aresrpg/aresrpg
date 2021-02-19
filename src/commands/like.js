import { write_chat_msg } from '../player/chat.js'

export const like_nodes = [
  {
    flags: {
      command_node_type: 1,
    },
    extraNodeData: 'like',
    children: [],
  },
]

export default function like({ server, sender }) {
  write_chat_msg(
    { server },
    {
      message: JSON.stringify([
        { text: ' ' + sender.username, color: 'gray' },
        { text: ' Aime ça', color: 'dark_aqua' },
        { text: ' !', color: 'blue' },
      ]),
      client: sender,
    }
  )
}
