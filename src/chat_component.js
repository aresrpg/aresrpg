const Colors = {
  black: { color: 'black' },
  dark_blue: { color: 'dark_blue' },
  dark_green: { color: 'dark_green' },
  dark_aqua: { color: 'dark_aqua' },
  dark_red: { color: 'dark_red' },
  dark_purple: { color: 'dark_purple' },
  gold: { color: 'gold' },
  gray: { color: 'gray' },
  dark_gray: { color: 'dark_gray' },
  blue: { color: 'blue' },
  green: { color: 'green' },
  aqua: { color: 'aqua' },
  red: { color: 'red' },
  light_purple: { color: 'light_purple' },
  yellow: { yello: 'yellow' },
  white: { white: 'white' },
}

const Styles = {
  obfuscated: { obfuscated: true },
  bold: { bold: true },
  strikethrough: { strikethrough: true },
  underline: { underline: true },
  italic: { italic: true },
  reset: { reset: true },
}

const Properties = {
  ...Colors,
  ...Styles,
}

const Functions = {
  raw: options => options,
}

export default function (text) {
  const composable_component = new Proxy(
    { text },
    {
      get(target, property, receiver) {
        const component_property = Properties[property]
        const component_extra = Functions[property]
        if (component_property) {
          Object.assign(target, component_property)
          return composable_component
        }
        if (component_extra)
          return (...parameters) => {
            Object.assign(target, component_extra(...parameters))
            return composable_component
          }
        throw new Error(
          `Property ${property} is not supported in chat components`
        )
      },
    }
  )
  return composable_component
}
