import { Position } from '../chat.js'

const GameMode = {
  SURVIVAL: 0,
  CREATIVE: 1,
  ADVENTURE: 2,
  SPECTATOR: 3,
}

export default function gamemode({ args, sender }) {
  const by_name = args[0].toUpperCase() in GameMode && args[0].toUpperCase()
  const [by_number] =
    Object.entries(GameMode).find(([, id]) => Number(args[0]) === id) ?? []
  const mode = by_name || by_number

  if (!mode) {
    sender.write('chat', {
      message: JSON.stringify({
        translate: 'arguments.operation.invalid',
        color: 'red',
      }),
      position: Position.CHAT,
      sender: sender.uuid,
    })
    return
  }

  const message = {
    translate: 'commands.gamemode.success.self',
    with: [{ translate: `gameMode.${mode.toLowerCase()}` }],
  }

  const gameMode = GameMode[mode]

  sender.write('game_state_change', {
    reason: 3, // game_state_change is not only for gamemode but for a lot of things. And 3 is for gamemode.
    gameMode,
  })

  sender.write('chat', {
    message: JSON.stringify(message),
    position: Position.CHAT,
    sender: '00000000000000000000000000000000',
  })
}
