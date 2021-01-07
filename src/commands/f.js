import { Position } from '../chat.js'

export const f_nodes = [
  {
    flags: {
      command_node_type: 1,
    },
    extraNodeData: 'f',
    children: [],
  },
]

export default function f({ sender }) {
  sender.write('chat', {
    message: JSON.stringify([
      { text: ' ' + sender.username, color: 'gray' },
      { text: " trouve qu'il y a trop de", color: 'yellow' },
      { text: ' fragile', color: 'blue', bold: 'true' },
      { text: ' ici', color: 'yellow' },
      { text: ' !', color: 'blue' },
    ]),
    position: Position.CHAT,
    sender: sender.uuid,
  })
}
