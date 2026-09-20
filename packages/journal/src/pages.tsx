// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SITE_URL, SITE_COVER, article_path, article_url, cover_path, type PublishedArticle } from './content.ts'

const Masthead = () => (
  <header className="masthead">
    <a className="wordmark" href="/" aria-label="AresRPG Journal home">
      <img src="/favicon.png" width="30" height="30" alt="" />
      ARESRPG <span>/ journal</span>
    </a>
    <a href="/">All stories ↗</a>
  </header>
)

const Footer = () => (
  <footer className="footer">
    <span>AresRPG · Stories about making a world.</span>
    <nav aria-label="More from AresRPG">
      <a href="/feed.xml">RSS</a>
      <a href="https://aresrpg.world">Play AresRPG ↗</a>
    </nav>
  </footer>
)

const Document = ({
  title,
  description,
  path,
  cover,
  article,
  children,
}: Readonly<{
  title: string
  description: string
  path: string
  cover?: string
  article?: PublishedArticle
  children: ReactNode
}>) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>{`${title} — AresRPG Journal`}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={`${SITE_URL}${path}`} />
      <link rel="stylesheet" href="/assets/journal.css" />
      <link rel="icon" href="/favicon.png" type="image/png" />
      <link rel="apple-touch-icon" href="/favicon.png" />
      <link rel="alternate" type="application/rss+xml" title="AresRPG Journal" href="/feed.xml" />
      <meta property="og:site_name" content="AresRPG Journal" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={`${SITE_URL}${path}`} />
      <meta property="og:type" content={article ? 'article' : 'website'} />
      <meta name="twitter:card" content={cover ? 'summary_large_image' : 'summary'} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      {cover && (
        <>
          <meta property="og:image" content={`${SITE_URL}${cover}`} />
          <meta name="twitter:image" content={`${SITE_URL}${cover}`} />
        </>
      )}
      {article && (
        <>
          <meta property="article:published_time" content={article.published_on!} />
          <meta property="article:author" content="AresRPG" />
          <meta property="og:image:alt" content={article.cover_alt} />
        </>
      )}
      <script src="/assets/analytics.js" defer />
    </head>
    <body>
      <a className="skip" href="#story">
        Skip to story
      </a>
      <Masthead />
      {children}
      <Footer />
    </body>
  </html>
)

const ArticleCard = ({ article }: Readonly<{ article: PublishedArticle }>) => (
  <article className="article-card">
    <a href={article_path(article)}>
      <span className="article-thumbnail">
        <img src={cover_path(article)} width="1672" height="941" alt={article.cover_alt} />
      </span>
      <h2>{article.title}</h2>
      <p>{article.description}</p>
      <div className="article-meta">
        <span className="chapter">
          {article.series} · {String(article.chapter).padStart(2, '0')}
        </span>
        <span aria-hidden="true">·</span>
        <span>{article.minutes} min read</span>
      </div>
    </a>
  </article>
)

export const render_index = (articles: readonly PublishedArticle[]) =>
  '<!doctype html>' +
  renderToStaticMarkup(
    <Document
      title="Stories from an onchain world"
      description="The AresRPG journal. A practical, human guide to building games whose rules live on Sui."
      path="/"
      cover={`/assets/${SITE_COVER}`}
    >
      <main className="archive-page" id="story">
        <header className="archive-heading">
          <h1>Latest stories</h1>
          <p>What we’re learning as we build a world on Sui.</p>
        </header>
        <div className="article-grid">
          {articles.map((article) => (
            <ArticleCard key={article.slug} article={article} />
          ))}
        </div>
      </main>
    </Document>
  )

export const render_article = (article: PublishedArticle, next?: PublishedArticle) =>
  '<!doctype html>' +
  renderToStaticMarkup(
    <Document
      title={article.title}
      description={article.description}
      path={article_path(article)}
      cover={cover_path(article)}
      article={article}
    >
      <main className="page" id="story">
        <article>
          <header>
            <p className="kicker">Building an onchain RPG · {String(article.chapter).padStart(2, '0')}</p>
            <h1>{article.title}</h1>
            <p className="subtitle">{article.description}</p>
            <p className="byline">
              <span className="author">Words from AresRPG</span>
              <span aria-hidden="true">·</span>
              <time dateTime={article.published_on!}>
                {new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(
                  new Date(article.published_on!)
                )}
              </time>
              <span aria-hidden="true">·</span>
              <span>{article.minutes} min read</span>
            </p>
          </header>
          <figure className="cover">
            <img src={cover_path(article)} width="1672" height="941" alt={article.cover_alt} />
          </figure>
          <div className="prose" dangerouslySetInnerHTML={{ __html: article.body }} />
          <div className="endmark" aria-hidden="true">
            ▪
          </div>
          <nav className="next" aria-label="More stories">
            <p className="kicker">{next ? 'Keep reading' : 'From the journal'}</p>
            <a href={next ? article_url(next) : '/'}>{next ? `${next.title} →` : '← All stories'}</a>
          </nav>
        </article>
      </main>
    </Document>
  )

export const render_not_found = () =>
  '<!doctype html>' +
  renderToStaticMarkup(
    <Document
      title="Story not found"
      description="This story is not available. Browse published articles in the AresRPG Journal."
      path="/404"
    >
      <main className="page" id="story">
        <h1>This story isn’t here.</h1>
        <p className="subtitle">It may have moved, or it may not be published yet.</p>
        <a href="/">Browse the journal →</a>
      </main>
    </Document>
  )
