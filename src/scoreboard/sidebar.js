import {
  Positions,
  Types,
  ScoreActions,
  ChatColor,
  ObjectiveActions,
} from './enums.js'
import { chat_to_text } from './util.js'

function make_unique(lines) {
  return lines?.map((line, i) => {
    const count = lines.slice(0, i).filter(({ text }) => text === line.text)
      .length

    return { ...line, text: `${line.text}${ChatColor.RESET.repeat(count)}` }
  })
}

/**
 * Update sidebar of a client
 * @param {{client: any}} Client
 * @param {{last: {title: Chat, lines: Chat[]}, next: {title: Chat, lines: Chat[]}} Options
 */
export function update_sidebar({ client }, { last, next }) {
  const lastLines = make_unique(
    last.lines?.map((item, index, { length }) => ({
      text: chat_to_text(item).slice(0, 40),
      line: length - index,
    })) ?? []
  )
  const nextLines =
    make_unique(
      next.lines?.map((item, index) => ({
        text: chat_to_text(item).substring(0, 40),
        line: next.lines.length - index,
      }))
    ) ?? []

  if (last.title !== next.title) {
    const name = client.username

    if (next.title === undefined) {
      client.write('scoreboard_objective', {
        name,
        action: ObjectiveActions.REMOVE,
      })
    } else {
      const displayText = JSON.stringify(next.title)
      const type = Types.INTEGER

      if (last.title === undefined) {
        client.write('scoreboard_objective', {
          name,
          displayText,
          type,
          action: ObjectiveActions.CREATE,
        })
        client.write('scoreboard_display_objective', {
          position: Positions.SIDEBAR,
          name,
        })
      } else
        client.write('scoreboard_objective', {
          name,
          displayText,
          type,
          action: ObjectiveActions.UPDATE,
        })
    }
  }

  const itemsToDelete = lastLines.filter((item) => {
    const sameLine = nextLines.find((item2) => item.line === item2.line)
    return sameLine?.text !== item.text ?? true
  })
  const itemsToUpdate = nextLines.filter(
    (item) =>
      !lastLines.some(
        (item2) => item.text === item2.text && item.line === item2.line
      )
  )

  for (const item of itemsToDelete) {
    const obj = {
      scoreName: client.username,
      action: ScoreActions.REMOVE,
      itemName: item.text,
      value: item.line,
    }

    client.write('scoreboard_score', obj)
  }

  for (const item of itemsToUpdate) {
    const obj = {
      scoreName: client.username,
      action: ScoreActions.UPDATE,
      itemName: item.text,
      value: item.line,
    }

    client.write('scoreboard_score', obj)
  }
}
