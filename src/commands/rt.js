import { world_chat_msg } from '../chat.js'

import { literal } from './declare_options.js'

export const rt_nodes = [
  literal({
    value: 'rt',
    flags: {
      has_command: true,
    },
  }),
]

export default function rt({ world, sender }) {
  world_chat_msg({
    world,
    message: JSON.stringify([
      { text: ' ' + sender.username, color: 'gray' },
      { text: ' a', color: 'blue' },
      { text: ' Retweet', color: 'aqua' },
      { text: ' !', color: 'blue' },
    ]),
    client: sender,
  })
}
