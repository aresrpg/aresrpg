import { Position } from '../chat.js'

export const like_nodes = [
  {
    flags: {
      command_node_type: 1,
    },
    extraNodeData: 'like',
    children: [],
  },
]

export default function like({ sender }) {
  sender.write('chat', {
    message: JSON.stringify([
      { text: ' ' + sender.username, color: 'gray' },
      { text: ' Aime ça', color: 'dark_aqua' },
      { text: ' !', color: 'blue' },
    ]),
    position: Position.CHAT,
    sender: sender.uuid,
  })
}
