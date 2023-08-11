import Gradient from 'javascript-color-gradient'

const top_gradient = new Gradient()
const bottom_gradient = new Gradient()
const top_line = 'The lands of AresRPG'
const bottom_line = '→ A delightful mmorpg experience in minecraft !'

const TOP_COLOR_FROM = '#FB8C00'
const TOP_COLOR_TO = '#FFD54F'

top_gradient
  .setMidpoint(top_line.length)
  .setColorGradient(TOP_COLOR_FROM, TOP_COLOR_TO)

bottom_gradient
  .setMidpoint(bottom_line.length)
  .setColorGradient('#95A5A6', '#34495E')

export default [
  {
    text: '₪ '.padStart(11, ' '),
    color: TOP_COLOR_FROM,
    bold: true,
  },
  ...top_gradient.getColors().map((color, index) => ({
    text: top_line[index],
    color,
    bold: true,
    underlined: true,
  })),
  {
    text: ' §l₪',
    color: TOP_COLOR_TO,
    bold: true,
  },
  {
    text: '\n',
  },
  ...bottom_gradient.getColors().map((color, index) => ({
    text: bottom_line[index],
    color,
    bold: false,
  })),
]
