import { client_chat_msg, Formats } from '../chat.js'

import { write_error } from './commands.js'
import { integer, literal } from './declare_options.js'

const MIN_UI_LEFT_OFFSET = -900
const MAX_UI_LEFT_OFFSET = -100

export const settings_nodes = [
  literal({
    value: 'settings',
    children: [
      literal({
        value: 'top_left_ui_offset',
        children: [
          integer({
            name: 'Offset of the top left UI',
          }),
        ],
      }),
    ],
  }),
]

export default function settings({ sender, dispatch, args }) {
  if (args.length < 2) {
    write_error({ sender })
    return
  }

  const [cmd, value] = args

  switch (cmd) {
    case 'top_left_ui_offset':
      if (!Number.isNaN(value)) {
        const top_left_ui_offset = Math.max(
          MIN_UI_LEFT_OFFSET,
          Math.min(MAX_UI_LEFT_OFFSET, value),
        )
        dispatch('UPDATE_SETTINGS', { top_left_ui_offset })
        client_chat_msg({
          client: sender,
          message: [
            { text: 'settings.top_left_ui_offset updated: ', ...Formats.BASE },
            { text: top_left_ui_offset, ...Formats.SUCCESS },
          ],
        })
      }
      break
    default:
      write_error({ sender })
  }
}
