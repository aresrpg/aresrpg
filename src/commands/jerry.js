import { Position } from '../chat.js'

export const jerry_nodes = [
  {
    flags: {
      command_node_type: 1,
    },
    extraNodeData: 'jerry',
    children: [],
  },
]

export default function jerry({ sender }) {
  sender.write('chat', {
    message: JSON.stringify([
      { text: ' ' + sender.username, color: 'gray' },
      { text: ' Harry Golay !', color: 'blue' },
    ]),
    position: Position.CHAT,
    sender: sender.uuid,
  })
}
