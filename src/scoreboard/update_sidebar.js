import equals from 'fast-deep-equal'

import { normalize_chat_component, MAGIC_RESET } from '../chat.js'

import inline_component from './inline_component.js'

const Action = {
  UPSERT: 0,
  REMOVE: 1,
}

function no_duplicates(components) {
  return ({ component, index }) => {
    const { length } = components
      .slice(0, index)
      .map(normalize_chat_component)
      .filter(current_component => equals(current_component, component))

    const [first, ...tail] = component

    return {
      component: [
        { ...first, text: `${MAGIC_RESET.repeat(length)}${first.text ?? ''}` },
        ...tail,
      ],
      index,
    }
  }
}

function only_changes(components) {
  return ({ component, index }) =>
    !equals(components.map(normalize_chat_component)[index], component)
}

function create_packets(scoreName, last) {
  return ({ component, index }) => [
    {
      scoreName,
      action: Action.REMOVE,
      itemName: inline_component(last[index]).slice(0, 40),
      value: index + 1,
    },
    {
      scoreName,
      action: Action.UPSERT,
      itemName: inline_component(component).slice(0, 40),
      value: index + 1,
    },
  ]
}

function write_packets(client) {
  return packet => client.write('scoreboard_score', packet)
}

export default function ({ client, scoreboard_name }) {
  return ({ last, next }) =>
    next
      .map(normalize_chat_component)
      .map((component, index) => ({ component, index }))
      .filter(only_changes(last))
      .map(no_duplicates(next))
      .flatMap(create_packets(scoreboard_name, last))
      .forEach(write_packets(client))
}
