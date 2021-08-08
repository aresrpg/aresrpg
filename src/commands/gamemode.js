import { Position } from '../player/chat.js'
import { SERVER_UUID } from '../index.js'

import { write_error } from './commands.js'
import { CommandNodeTypes, ParserProperties } from './declare_options.js'

const GameMode = {
  SURVIVAL: 0,
  CREATIVE: 1,
  ADVENTURE: 2,
  SPECTATOR: 3,
}

const is_gamemode_value = (value) => Object.values(GameMode).includes(value)
const parse_gamemode = (param) => {
  if (is_gamemode_value(+param)) return +param
  return GameMode[param.toUpperCase()]
}
const gamemode_from_value = (value) =>
  Object.keys(GameMode).find((k) => GameMode[k] === value)

export const gamemode_nodes = [
  {
    flags: {
      command_node_type: CommandNodeTypes.LITERAL,
    },
    extraNodeData: 'gm',
    children: [
      {
        flags: {
          command_node_type: CommandNodeTypes.ARGUMENT,
          has_command: true,
        },
        children: [],
        extraNodeData: {
          name: 'gamemode name or number (0-3)',
          parser: 'brigadier:string',
          properties: ParserProperties.string.SINGLE_WORD,
        },
      },
    ],
  },
  {
    flags: {
      command_node_type: CommandNodeTypes.LITERAL,
    },
    extraNodeData: 'gamemode',
    children: [
      {
        flags: {
          command_node_type: CommandNodeTypes.ARGUMENT,
          has_command: true,
        },
        children: [],
        extraNodeData: {
          name: 'gamemode name or number (0-3)',
          parser: 'brigadier:string',
          properties: ParserProperties.string.SINGLE_WORD,
        },
      },
    ],
  },
]

export default function gamemode({ args, sender }) {
  if (args.length === 1) {
    const [input_mode] = args
    const gameMode = parse_gamemode(input_mode)

    if (gameMode !== undefined) {
      // value can be 0 so chill and don't refac u nerd
      sender.write('game_state_change', {
        reason: 3, // @see https://wiki.vg/Protocol#Change_Game_State
        gameMode,
      })
      sender.write('chat', {
        message: JSON.stringify({
          translate: 'commands.gamemode.success.self',
          with: [
            {
              translate: `gameMode.${gamemode_from_value(
                gameMode
              ).toLowerCase()}`,
            },
          ],
        }),
        position: Position.CHAT,
        sender: SERVER_UUID,
      })
      return
    }
  }

  write_error({ sender })
}
