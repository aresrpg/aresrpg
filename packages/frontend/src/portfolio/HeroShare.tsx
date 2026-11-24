// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useReducer } from 'react'
import { hero_power } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'
import { Button } from '@aresrpg/ui'
import { Link, Share2 } from 'lucide-react'

import { NewTabLink, x_post_url } from '../components/links.tsx'
import { ModalFrame } from '../components/ModalFrame.tsx'
import {
  hero_share_path,
  initial_portrait_share,
  portrait_poster_url,
  reduce_portrait_share,
} from '../components/portrait_share.ts'
import { titleize } from '../content/titles.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { useSiteStore } from '../store.ts'
import { toast } from '../toast.ts'

/** The hero's poster, drawn by the portrait service from the facts the page holds. */
const hero_poster_url = (hero: Readonly<CharacterRow>): string | null =>
  portrait_poster_url(hero, {
    name: hero.name,
    level: hero.level,
    power: hero_power(hero.equipment),
    gear: hero.equipment.map(({ item_type }) => item_type),
  })

/** The share window of a hero: the poster itself, as the service serves it, then the post and its link. The
 *  link is the hero's share page, whose card is this same poster, built by the server from the index's facts. The
 *  preview keeps the card's size while it loads. A hero the poster refuses has no page, so its post carries no link. */
export const HeroShare = ({
  copy,
  hero,
  close,
}: Readonly<{ copy: AppCopy; hero: CharacterRow; close: () => void }>) => {
  const text = copy_text(copy.portfolio_page)
  const locale = useSiteStore((state) => state.locale)
  const [{ generation, loaded, status }, dispatch] = useReducer(reduce_portrait_share, initial_portrait_share)
  const poster = hero_poster_url(hero)
  const image_failed = !poster || (status === 'failed' && !loaded)
  const page = poster && new URL(hero_share_path(hero.id, locale), window.location.origin).href
  const post = text('share_text', {
    classe: titleize(hero.classe),
    level: hero.level,
    power: hero_power(hero.equipment),
  })
  const copy_link = async (link: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(link)
      toast.add(copy.ui.portrait_copied, 'success')
    } catch (error) {
      console.error('Hero share link copy failed', error)
      toast.add(text('share_copy_failed'), 'error')
    }
  }
  return (
    <ModalFrame
      label={text('share_title', { name: hero.name })}
      close={close}
      close_label={copy.wallet_close}
      max_width="max-w-[560px]"
    >
      <div className="grid gap-3 px-4 pt-1 pb-4 [&_.aui-button]:min-h-11 [&_.aui-button]:gap-2 [&_.aui-button]:no-underline">
        <div className="relative aspect-[1200/630] w-full overflow-hidden rounded-ui border border-line bg-surface">
          {!loaded && !image_failed && <span className="aui-skeleton absolute inset-0 size-full rounded-none" />}
          {poster && (
            <img
              className={`size-full transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
              src={poster}
              alt={text('share_preview', { name: hero.name })}
              width={1200}
              height={630}
              onLoad={() => dispatch({ type: 'loaded', generation })}
              onError={() => dispatch({ type: 'image_failed', generation })}
            />
          )}
          {image_failed && (
            <p className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-danger" role="alert">
              {text('share_image_failed')}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 max-[420px]:grid-cols-1">
          <Button disabled={!page} onClick={() => page && void copy_link(page)}>
            <Link size={16} aria-hidden="true" />
            {text('share_copy')}
          </Button>
          <NewTabLink
            className="aui-button aui-button--primary"
            href={x_post_url(post, page ?? undefined)}
            new_tab={copy.site.new_tab}
          >
            <Share2 size={16} aria-hidden="true" />
            {text('share_post')}
          </NewTabLink>
        </div>
      </div>
    </ModalFrame>
  )
}
