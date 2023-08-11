import { client_chat_msg, Formats } from '../core/chat.js'

import { write_error } from './commands.js'
import { literal } from './declare_options.js'

const GameStates = ['GAME_ALIVE', 'GAME_GHOST']

export const switch_game_state_nodes = [
  literal({
    value: 'switch_game_state',
    children: GameStates.map(state =>
      literal({
        value: state,
        flags: {
          has_command: true,
        },
      }),
    ),
  }),
]

export default function switch_game_state({ sender, dispatch, args }) {
  if (args.length === 1) {
    const [new_game_state] = args

    if (GameStates.includes(new_game_state)) {
      const final_state = new_game_state.replaceAll('_', ':')
      client_chat_msg({
        client: sender,
        message: [
          { text: 'loading new game state: ', ...Formats.WARN },
          { text: final_state, ...Formats.INFO },
        ],
      })
      setTimeout(() => {
        dispatch('LOAD_GAME_STATE', final_state)
      }, 100)
      return
    }
  }

  write_error({ sender })
}
