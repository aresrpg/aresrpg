const Actions = {
  SET_TITLE: 0,
  SET_SUBSTITLE: 1,
  HIDE_TITLE: 4,
  RESET_TITLE: 5,
  SET_TIMES: 3,
}

const empty_component = { text: '' }

/**
 * Send a title to a client, all times are in seconds
 * @param {{ client: any, title?: any, subtitle?: any, times?: any }} arg
 */
export function write_title({
  client,
  title = empty_component,
  subtitle = empty_component,
  times,
}) {
  client.write('title', {
    action: Actions.RESET_TITLE,
  })
  client.write('title', {
    action: Actions.SET_TITLE,
    text: JSON.stringify(title),
  })
  client.write('title', {
    action: Actions.SET_SUBSTITLE,
    text: JSON.stringify(subtitle),
  })

  if (times) {
    const { fade_in = 1, fade_out = 1, stay = 1 } = times
    client.write('title', {
      action: Actions.SET_TIMES,
      fadeIn: fade_in * 20,
      fadeOut: fade_out * 20,
      stay: stay * 20,
    })
  }
}

export function delete_title({ client }) {
  client.write('title', {
    action: Actions.HIDE_TITLE,
  })
}
