import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { InteractionChip, key_cap_for_mode, press_interaction } from './InteractionChip.jsx'

const prompt = {
  id: 'search-zone',
  key: 'F',
  label: 'SEARCH THE ZONE',
  mobile_label: 'SEARCH THE ZONE',
}

describe('InteractionChip', () => {
  it('renders a keyless tap chip on mobile', () => {
    const html = renderToStaticMarkup(<InteractionChip prompt={prompt} on_trigger={() => {}} mobile={true} />)

    expect(html).toContain('data-mobile-interact="search-zone"')
    expect(html).toContain('SEARCH THE ZONE')
    expect(html).not.toContain('<kbd')
    expect(html).not.toContain('>F<')
  })

  it('keeps the desktop key cap and label when mobile mode is false', () => {
    const html = renderToStaticMarkup(<InteractionChip prompt={prompt} on_trigger={() => {}} mobile={false} />)

    expect(html).toContain('<kbd class="gw-npc-prompt__key">F</kbd>')
    expect(html).not.toContain('data-mobile-interact')
    expect(key_cap_for_mode('E', false)).toBe('E')
    expect(key_cap_for_mode('E', true)).toBeNull()
  })

  it('tap dispatches the same supplied action callback and consumes browser default', () => {
    let fired = 0
    let prevented = 0
    press_interaction(
      () => {
        fired += 1
      },
      {
        preventDefault() {
          prevented += 1
        },
      }
    )

    expect(fired).toBe(1)
    expect(prevented).toBe(1)
  })
})
