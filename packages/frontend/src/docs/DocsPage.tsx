// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The docs shell: a top bar, a floating category rail, then a written guide or an encyclopedia reference view.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { content_catalog } from '../content/catalog.ts'
import { ENCYCLOPEDIA_TABS, EncyclopediaContent } from '../encyclopedia/EncyclopediaContent.tsx'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import type { AppCopy } from '../i18n/copy.ts'

import { GuideBody, type GuideLinks } from './DocsGuides.tsx'
import { DocsLink, guide_title, sentence_case, type DocsCopy } from './docs_parts.tsx'
import {
  DOCS_NAV,
  DOCS_ORDER,
  DOCS_REFERENCES,
  docs_path,
  docs_path_of_encyclopedia,
  is_mechanic,
  docs_view,
  type DocsReference,
  type DocsSection,
} from './routes.ts'

import './docs.css'

export type DocsLinks = GuideLinks & Readonly<{ home: string; play: string }>
type Titles = (section: DocsSection) => string

const is_reference = (section: DocsSection): section is DocsReference =>
  (DOCS_REFERENCES as readonly string[]).includes(section)

/** Guides are titled by the docs copy; reference views keep the encyclopedia's own tab names. */
const section_titles = (copy: AppCopy): Titles => {
  const text = encyclopedia_text(copy)
  return (section) =>
    is_reference(section)
      ? text(ENCYCLOPEDIA_TABS.find(({ id }) => id === section)?.label ?? section)
      : is_mechanic(section)
        ? sentence_case(text(`gameplay.section_${section}`))
        : guide_title(copy.docs_page, section)
}

type Hit = Readonly<{ label: string; kind: string; to: string }>

const DocsSearch = ({ copy, titles }: Readonly<{ copy: DocsCopy; titles: Titles }>) => {
  const [query, set_query] = useState('')
  const index = useMemo<readonly Hit[]>(
    () => [
      ...DOCS_ORDER.map((section) => ({ label: titles(section), kind: copy.kinds.guide, to: docs_path(section) })),
      ...content_catalog.items.map(({ name, item_type }) => ({
        label: name,
        kind: copy.kinds.item,
        to: docs_path('items', item_type),
      })),
      ...content_catalog.mobs.map(({ name, mob_type }) => ({
        label: name,
        kind: copy.kinds.mob,
        to: docs_path('bestiary', mob_type),
      })),
    ],
    [copy, titles]
  )
  const needle = query.trim().toLowerCase()
  const hits = needle ? index.filter(({ label }) => label.toLowerCase().includes(needle)).slice(0, 12) : []
  return (
    <div className="docs-find" role="search">
      <input
        aria-label={copy.search}
        autoComplete="off"
        onChange={(event) => set_query(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && set_query('')}
        placeholder={copy.search}
        type="search"
        value={query}
      />
      {needle && (
        // A followed result closes the list: the click bubbles here after the link has navigated.
        <div className="docs-hits" onClick={() => set_query('')}>
          {hits.map((hit) => (
            <DocsLink key={hit.to} to={hit.to}>
              {hit.label}
              <small>{hit.kind}</small>
            </DocsLink>
          ))}
          {hits.length === 0 && <p>{copy.search_empty}</p>}
        </div>
      )}
    </div>
  )
}

const DocsRail = ({ copy, titles, current }: Readonly<{ copy: DocsCopy; titles: Titles; current: DocsSection }>) => (
  <nav aria-label={copy.nav_label} className="docs-rail" id="docs-rail">
    {DOCS_NAV.map(({ group, sections }) => (
      <div key={group}>
        <h2>{copy.groups[group]}</h2>
        {sections.map((section) => (
          <DocsLink current={section === current} key={section} to={docs_path(section)}>
            <i>{DOCS_ORDER.indexOf(section) + 1}</i>
            {titles(section)}
          </DocsLink>
        ))}
      </div>
    ))}
  </nav>
)

const Neighbours = ({ copy, titles, current }: Readonly<{ copy: DocsCopy; titles: Titles; current: DocsSection }>) => {
  const position = DOCS_ORDER.indexOf(current)
  const previous = DOCS_ORDER[position - 1]
  const next = DOCS_ORDER[position + 1]
  return (
    <nav aria-label={`${copy.previous} / ${copy.next}`} className="docs-neighbours">
      {previous ? (
        <DocsLink to={docs_path(previous)}>
          <small>{copy.previous}</small>
          <b>{titles(previous)}</b>
        </DocsLink>
      ) : (
        <span />
      )}
      {next && (
        <DocsLink to={docs_path(next)}>
          <small>{copy.next}</small>
          <b>{titles(next)}</b>
        </DocsLink>
      )}
    </nav>
  )
}

export const DocsPage = ({
  copy,
  links,
  pathname,
  navigate,
  language,
}: Readonly<{
  copy: AppCopy
  links: DocsLinks
  pathname: string
  navigate: (pathname: string) => void
  /** The page's language control, owned by the entry that can reload the copy. */
  language?: ReactNode
}>) => {
  const docs = copy.docs_page
  const view = docs_view(pathname)
  const titles = useMemo(() => section_titles(copy), [copy])
  const [menu_path, set_menu_path] = useState<string | null>(null)
  // The drawer belongs to the page it was opened on: any navigation closes it without an effect.
  const menu_open = menu_path === pathname
  const main = useRef<HTMLElement>(null)
  useEffect(() => {
    // Element.scrollTo may return a promise; an effect must return nothing.
    void main.current?.scrollTo(0, 0)
  }, [view.section])
  const group = DOCS_NAV.find(({ sections }) => sections.includes(view.section))?.group ?? 'start'
  return (
    <div className="docs aui-aura" data-menu={menu_open ? '' : undefined}>
      <header className="docs-bar">
        <button
          aria-controls="docs-rail"
          aria-expanded={menu_open}
          className="aui-button docs-menu"
          onClick={() => set_menu_path(menu_open ? null : pathname)}
          type="button"
        >
          {docs.menu}
        </button>
        <DocsLink className="docs-brand" to={docs_path('overview')}>
          <b>AresRPG</b>
          <span>{docs.title}</span>
        </DocsLink>
        <DocsSearch copy={docs} titles={titles} />
        <span className="docs-bar-space" />
        {language}
        <a className="docs-bar-link" href={links.home}>
          {docs.home}
        </a>
        <a className="aui-button aui-button--primary" href={links.play}>
          {docs.play}
        </a>
      </header>
      <div className="docs-shell">
        <DocsRail copy={docs} current={view.section} titles={titles} />
        {view.kind === 'guide' ? (
          <main className="docs-main" ref={main}>
            <article className="docs-article">
              <p className="docs-crumb">{docs.groups[group]}</p>
              <h1>{titles(view.section)}</h1>
              <GuideBody
                chooser={copy.landing_page.chooser}
                copy={docs}
                guide={view.section}
                links={links}
                text={encyclopedia_text(copy)}
              />
              <Neighbours copy={docs} current={view.section} titles={titles} />
              <p className="docs-stamp">{docs.data_note}</p>
            </article>
          </main>
        ) : (
          <main className="docs-main docs-main--reference" data-section={view.section} ref={main}>
            <p className="docs-crumb">
              {docs.groups[group]} / {titles(view.section)}
            </p>
            <section className="enc-page docs-reference flex min-h-0 min-w-0 flex-1 flex-col [&_button:not(:disabled)]:cursor-pointer">
              <EncyclopediaContent
                copy={copy}
                navigate={(encyclopedia_path) => navigate(docs_path_of_encyclopedia(encyclopedia_path))}
                pathname={view.encyclopedia_path}
              />
            </section>
          </main>
        )}
      </div>
    </div>
  )
}
