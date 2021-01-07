import { Position } from '../chat.js'

export const osef_nodes = [
  {
    flags: {
      command_node_type: 1,
    },
    extraNodeData: 'osef',
    children: [],
  },
]

export default function osef({ sender }) {
  sender.write('chat', {
    message: JSON.stringify([
      { text: ' ' + sender.username, color: 'gray' },
      { text: " S'en fout", color: 'dark_aqua' },
      { text: ' !', color: 'blue' },
    ]),
    position: Position.CHAT,
    sender: sender.uuid,
  })
}
