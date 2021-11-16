import { Position } from '../chat.js'
import { SERVER_UUID } from '../settings.js'
import { GameMode } from '../gamemode.js'
import { Action } from '../events.js'

import { write_error } from './commands.js'
import { literal, integer } from './declare_options.js'

const is_gamemode_value = value => Object.values(GameMode).includes(value)
const parse_gamemode = param => {
  if (is_gamemode_value(+param)) return +param
  return GameMode[param.toUpperCase()]
}
const gamemode_from_value = value =>
  Object.keys(GameMode).find(k => GameMode[k] === value)

const gamemode_args = [
  ...Object.keys(GameMode).map(key =>
    literal({
      value: key.toLowerCase(),
      flags: {
        has_command: true,
      },
    })
  ),
  integer({
    name: 'number',
    flags: {
      has_command: true,
    },
  }),
]

export const gamemode_nodes = [
  literal({
    value: 'gm',
    children: gamemode_args,
  }),
  literal({
    value: 'gamemode',
    children: gamemode_args,
  }),
]

export default function gamemode({ args, sender, dispatch }) {
  if (args.length === 1) {
    const [input_mode] = args
    const game_mode = parse_gamemode(input_mode)

    if (game_mode !== undefined) {
      // value can be 0 so chill and don't refac u nerd
      sender.write('game_state_change', {
        reason: 3, // @see https://wiki.vg/Protocol#Change_Game_State
        gameMode: game_mode,
      })
      sender.write('chat', {
        message: JSON.stringify({
          translate: 'commands.gamemode.success.self',
          with: [
            {
              translate: `gameMode.${gamemode_from_value(
                game_mode
              ).toLowerCase()}`,
            },
          ],
        }),
        position: Position.CHAT,
        sender: SERVER_UUID,
      })
      dispatch(Action.GAMEMODE, { game_mode })
      return
    }
  }

  write_error({ sender })
}
