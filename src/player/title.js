export function write_title_hide(client) {
  client.write('title', {
    action: 4,
  })
}

export function write_title_reset(client) {
  client.write('title', {
    action: 5,
  })
}

/**
 * Display title HUD
 *
 * example:
 * ```js
 * write_title(client, {
 *     title: { text: 'Bienvenu sur' },
 *     subtitle: { text: 'AresRPG ;)' },
 *     fadeIn: 5,
 *     fadeOut: 2,
 *     stay: 5
 *   })
 * ```
 * @param {import('minecraft-protocol').Client} client
 * @param {Object} options
 */
export function write_title(
  client,
  { title, subtitle, action, fadeIn, fadeOut, stay }
) {
  if (title || subtitle) {
    // We need to set a title to have a subtitle
    // That way we can handle the case where we display only a subtitle by having an empty tilte
    client.write('title', {
      action: 0,
      text: JSON.stringify(title || { text: '' }),
    })
  }
  if (subtitle) {
    client.write('title', {
      action: 1,
      text: JSON.stringify(subtitle),
    })
  }

  if (action) {
    client.write('title', {
      action: 2,
      text: JSON.stringify(action),
    })
  }

  client.write('title', {
    action: 3,
    fadeIn: fadeIn * 20,
    fadeOut: fadeOut * 20,
    stay: stay * 20,
  })
}
