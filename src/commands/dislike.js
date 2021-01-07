import { Position } from '../chat.js'

export const dislike_nodes = [
  {
    flags: {
      command_node_type: 1,
    },
    extraNodeData: 'dislike',
    children: [],
  },
]

export default function dislike({ sender }) {
  sender.write('chat', {
    message: JSON.stringify([
      { text: ' ' + sender.username, color: 'gray' },
      { text: ' a', color: 'blue' },
      { text: ' Dislike', color: 'red' },
      { text: ' !', color: 'blue' },
    ]),
    position: Position.CHAT,
    sender: sender.uuid,
  })
}
