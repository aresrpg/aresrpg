import { Position } from '../chat.js'

export const rt_nodes = [
  {
    flags: {
      command_node_type: 1,
    },
    extraNodeData: 'rt',
    children: [],
  },
]

export default function rt({ sender }) {
  sender.write('chat', {
    message: JSON.stringify([
      { text: ' ' + sender.username, color: 'gray' },
      { text: ' a', color: 'blue' },
      { text: ' Retweet', color: 'aqua' },
      { text: ' !', color: 'blue' },
    ]),
    position: Position.CHAT,
    sender: sender.uuid,
  })
}
