import { Position } from '../chat.js'

export const ragequit_nodes = [
  {
    flags: {
      command_node_type: 1,
    },
    extraNodeData: 'ragequit',
    children: [],
  },
]

export default function ragequit({ sender }) {
  sender.write('chat', {
    message: JSON.stringify([
      { text: ' ' + sender.username, color: 'gray' },
      { text: ' a RageQuit !', color: 'red' },
    ]),
    position: Position.CHAT,
    sender: sender.uuid,
  })
  sender.write('kick_disconnect', { reason: JSON.stringify('§ert si c trist') })
}
