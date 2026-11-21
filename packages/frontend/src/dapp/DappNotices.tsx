// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterRow } from '@aresrpg/protocol'
import { Button } from '@aresrpg/ui'

import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { dapp_error, dapp_text, direct_text } from './copy.ts'
import type { DirectRequest } from './direct.ts'
import type { DappCommand } from './state.ts'

import './dapp_parts.css'

type Heroes = readonly Readonly<Pick<CharacterRow, 'id' | 'name'>>[]
type Refusal = Readonly<{ reason: string; names: string }>
/** A refusal names its heroes once per reason, in the order the reasons arrived. */
const refusals = (commands: readonly DappCommand[], heroes: Heroes): readonly Refusal[] => {
  const refused = commands.filter(({ status }) => status === 'refused')
  const reasons = [...new Set(refused.map(({ error }) => error ?? 'unknown'))]
  return reasons.map((reason) => {
    const hero_ids = refused.flatMap(({ error, hero_id }) => ((error ?? 'unknown') === reason ? [hero_id] : []))
    const names = heroes.filter(({ id }) => hero_ids.includes(id)).map(({ name }) => name)
    return { reason, names: names.join(', ') }
  })
}

/** While the bot holds the request there is nothing to press: one sentence says where it stands. */
const WAITS: Readonly<Partial<Record<DirectRequest['status'], string>>> = {
  pending: 'blocker_command_pending',
  accepted: 'direct_queued',
}
const dismiss = (): void => dispatch_app({ type: 'dapp/direct_dismissed' })

/**
 * The one direct request of the bot wallet. A resolved one says what happened, or why not, in one
 * sentence, and stays until dismissed. An unknown answer is told by the notice all requests share.
 */
const DirectNotice = ({
  copy,
  request,
  heroes,
}: Readonly<{ copy: AppCopy; request: DirectRequest; heroes: Heroes }>) => {
  const wait = WAITS[request.status]
  if (wait)
    return (
      <p className="dapp-note" role="status" aria-busy="true" data-direct={request.status}>
        {dapp_text(copy, wait)}
      </p>
    )
  if (request.status === 'uncertain') return null
  const refused = request.status === 'refused'
  return (
    <div className="dapp-notice-row" role={refused ? 'alert' : 'status'} data-direct={request.status}>
      <p className={refused ? 'dapp-error' : 'dapp-notice-text'}>{direct_text(copy, request, heroes)}</p>
      <Button onClick={dismiss}>{dapp_text(copy, 'position_dismiss')}</Button>
    </div>
  )
}

/**
 * What the bot was asked and has not settled for good: starts and stops that were refused, the one
 * direct request, and one calm notice for every answer that is still unknown. A refusal code becomes
 * a sentence here; no code of the bot is ever shown.
 */
export const DappNotices = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const commands = useAppStore(({ dapp }) => dapp.commands)
  const direct = useAppStore(({ dapp }) => dapp.direct)
  const heroes = useAppStore(({ session }) => session.agent_inventory.characters)
  const list = Object.values(commands)
  const uncertain = [...list, direct].some((asked) => asked?.status === 'uncertain')
  const refused = refusals(list, heroes)
  if (!uncertain && !refused.length && !direct) return null
  return (
    <div className="dapp-notices">
      {uncertain && (
        <p className="dapp-warning" role="status">
          {dapp_text(copy, 'command_uncertain')}
        </p>
      )}
      {refused.map(({ reason, names }) => (
        <p key={reason} className="dapp-error" role="alert">
          {dapp_text(copy, 'command_refused', { names, reason: dapp_error(copy, reason) })}
        </p>
      ))}
      {direct && <DirectNotice copy={copy} request={direct} heroes={heroes} />}
    </div>
  )
}
