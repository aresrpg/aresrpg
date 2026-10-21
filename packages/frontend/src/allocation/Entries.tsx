// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState, useEffect } from 'react'
import { campaign } from '@aresrpg/immutable/allocation'
import { LEADERBOARD_METRICS } from '@aresrpg/protocol'

import type { CopyText } from '../i18n/copy.ts'

import type { AllocationRuntime, AllocationState } from './runtime.ts'
import { short_address } from './view.ts'

const SavedEntry = ({ state, text }: Readonly<{ state: AllocationState; text: CopyText }>) => {
  const { submission, wallets } = state.status!
  if (!submission) return null
  const recipient = wallets.find(({ address }) => address === submission.address)
  return (
    <>
      <p className="xp-ok">
        ✓ {text('saved_posts', { count: submission.posts.length, max: campaign.social.max_posts })}
      </p>
      <ol className="xp-posts">
        {submission.posts.map((id) => (
          <li key={id}>
            <a href={`https://x.com/i/status/${id}`} target="_blank" rel="noopener noreferrer">
              x.com/i/status/{id}
            </a>
          </li>
        ))}
      </ol>
      <p className="xp-wallet">
        {text('recipient')}:{' '}
        <b>{recipient ? recipient.label || text('google_wallet') : short_address(submission.address)}</b>{' '}
        <code>{short_address(submission.address)}</code>
      </p>
      <p className="xp-fine">{text('metrics_note')}</p>
    </>
  )
}
const EntryForm = ({
  state,
  runtime,
  text,
  cancel,
}: Readonly<{ state: AllocationState; runtime: AllocationRuntime; text: CopyText; cancel: () => void }>) => {
  const { submission, wallets } = state.status!
  const locked = !!state.task
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        runtime.dispatch({
          type: 'request',
          task: {
            kind: 'submit',
            address: submission?.address ?? String(form.get('address')),
            urls: ['0', '1', '2'].map((key) => String(form.get(key) ?? '').trim()).filter(Boolean),
          },
        })
      }}
    >
      <label className="field">
        <span>{text('recipient')}</span>
        <select name="address" required disabled={!!submission || locked} defaultValue={submission?.address ?? ''}>
          <option value="">{text('choose_wallet')}</option>
          {wallets.map((wallet) => (
            <option key={wallet.address} value={wallet.address}>
              {wallet.label || text('google_wallet')} · {short_address(wallet.address)}
            </option>
          ))}
        </select>
        {submission && <small>{text('recipient_locked')}</small>}
      </label>
      <div className="xp-fields">
        {Array.from({ length: campaign.social.max_posts }, (_, index) => (
          <label className="field" key={index}>
            <span>
              {text('post_number', { number: index + 1 })}
              {index > 0 ? ` · ${text('optional')}` : ''}
            </span>
            <input
              name={String(index)}
              type="url"
              inputMode="url"
              required={index === 0}
              maxLength={300}
              disabled={locked}
              placeholder="https://x.com/…/status/…"
              defaultValue={submission?.posts[index] ? `https://x.com/i/status/${submission.posts[index]}` : ''}
            />
          </label>
        ))}
      </div>
      <div className="xp-actions">
        <span className="xp-max">{text('post_limit', { max: campaign.social.max_posts })}</span>
        {submission && (
          <button type="button" className="btn" onClick={cancel}>
            {text('cancel')}
          </button>
        )}
        <button className="btn btn-ink" disabled={locked}>
          {text('save')}
        </button>
      </div>
    </form>
  )
}

const XHeader = ({
  state,
  runtime,
  text,
  open,
  saved,
  edit,
}: Readonly<{
  state: AllocationState
  runtime: AllocationRuntime
  text: CopyText
  open: boolean
  saved: boolean
  edit: () => void
}>) => {
  const { user } = state.status!
  const busy = !!state.task
  return (
    <header className="xp-head">
      <span className="xp-logo">𝕏</span>
      <div>
        <h3>{text('x_entry')}</h3>
        <p>{user ? `@${user.username}` : text(open ? 'x_connect_note' : 'closed')}</p>
      </div>
      {!user && open && (
        <button
          className="btn btn-ink"
          disabled={busy}
          onClick={() => runtime.dispatch({ type: 'request', task: { kind: 'link_x' } })}
        >
          {text('connect_x')}
        </button>
      )}
      {saved && open && (
        <button className="btn" disabled={busy} onClick={edit}>
          {text('edit')}
        </button>
      )}
    </header>
  )
}

const XEntry = ({
  state,
  runtime,
  text,
  open,
}: Readonly<{ state: AllocationState; runtime: AllocationRuntime; text: CopyText; open: boolean }>) => {
  const [editing, set_editing] = useState(false)
  const { user, submission } = state.status!
  const saved = !!submission && !editing
  useEffect(() => set_editing(false), [submission?.submitted_at])
  return (
    <section className={`xpanel ${saved ? 'is-saved' : 'is-editing'}`}>
      <XHeader state={state} runtime={runtime} text={text} open={open} saved={saved} edit={() => set_editing(true)} />
      {saved && <SavedEntry state={state} text={text} />}
      {user && !saved && open && (
        <EntryForm state={state} runtime={runtime} text={text} cancel={() => set_editing(false)} />
      )}
      <p className="xp-fine">{text('entry_note')}</p>
    </section>
  )
}

export const Entries = ({
  state,
  runtime,
  text,
  open,
}: Readonly<{ state: AllocationState; runtime: AllocationRuntime; text: CopyText; open: boolean }>) => (
  <section className={`step ${state.status?.submission ? 'is-done' : ''}`}>
    <div className="step-head">
      <span className="step-num">{state.status?.submission ? '✓' : '2'}</span>
      <div>
        <h2>{text('get_spot')}</h2>
        <p>{text('get_spot_note')}</p>
      </div>
    </div>
    <div className="ways">
      <article className="way">
        <header>
          <span className="way-icon" aria-hidden="true">
            ▥
          </span>
          <div>
            <h3>{text('leaderboard_title')}</h3>
            <p className="way-count">
              <b>
                {text('spots_count', { count: campaign.tiers.veteran.leaderboard + campaign.tiers.member.leaderboard })}
              </b>{' '}
              · {campaign.tiers.veteran.leaderboard} {text('veteran')} · {campaign.tiers.member.leaderboard}{' '}
              {text('member')}
            </p>
          </div>
        </header>
        <p>{text('leaderboard_note')}</p>
        <ul className="way-steps">
          <li>{text('veteran_boards')}</li>
          <li>{text('member_boards')}</li>
          <li>{text('skip_duplicates')}</li>
        </ul>
        <div className="boards">
          {LEADERBOARD_METRICS.map((name, index) => (
            <span className="board" key={name}>
              <span>{text(`metric_${name}`)}</span>
              <b className="t-vet">
                {Math.floor(campaign.tiers.veteran.leaderboard / LEADERBOARD_METRICS.length) +
                  Number(index < campaign.tiers.veteran.leaderboard % LEADERBOARD_METRICS.length)}
              </b>
              <b className="t-mem">{campaign.tiers.member.leaderboard / LEADERBOARD_METRICS.length}</b>
            </span>
          ))}
        </div>
        <p className="way-legend">{text('board_legend')}</p>
        <a className="btn btn-ink" href="/">
          {text('play')} ↗
        </a>
      </article>
      <article className="way">
        <header>
          <span className="way-icon x">𝕏</span>
          <div>
            <h3>{text('x_title')}</h3>
            <p className="way-count">
              <b>{text('spots_count', { count: campaign.tiers.veteran.social + campaign.tiers.member.social })}</b> ·{' '}
              {campaign.tiers.veteran.social} {text('veteran')} · {campaign.tiers.member.social} {text('member')}
            </p>
          </div>
        </header>
        <p>{text('x_note')}</p>
        <ul className="way-steps">
          <li>{text('one_entry')}</li>
          <li>{text('score_rule')}</li>
          <li>{text('x_winners', { veteran: campaign.tiers.veteran.social, member: campaign.tiers.member.social })}</li>
          <li>{text('leftovers')}</li>
        </ul>
        <p className="way-fine">{text('quality_rule')}</p>
        {state.status && <XEntry key={state.google?.address} state={state} runtime={runtime} text={text} open={open} />}
      </article>
    </div>
  </section>
)
