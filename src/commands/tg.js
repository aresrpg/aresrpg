import { Position } from '../chat.js'

export const tg_nodes = [
  {
    flags: {
      command_node_type: 1,
    },
    extraNodeData: 'tg',
    children: [],
  },
]

export default function tg({ sender }) {
  sender.write('chat', {
    message: JSON.stringify([
      { text: ' ' + sender.username, color: 'gray' },
      { text: ' Demande le', color: 'gold' },
      { text: ' silence', color: 'red', bold: 'true' },
      { text: ' !', color: 'blue' },
    ]),
    position: Position.CHAT,
    sender: sender.uuid,
  })
}
