// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const TOAST_CONTAINER_CLASS =
  'fixed top-[max(1rem,var(--safe-top))] right-[max(1rem,var(--safe-right))] z-[300] flex max-h-[calc(100dvh-max(1rem,var(--safe-top))-max(1rem,var(--safe-bottom)))] max-w-[min(24rem,calc(100vw-max(1rem,var(--safe-left))-max(1rem,var(--safe-right))))] flex-col items-end gap-2 overflow-hidden'

export const toast_glass_class =
  'flex flex-col gap-2 p-4 border border-white/10 bg-black/70 backdrop-blur-md rounded-[7px] animate-[slide-in_0.3s_ease-out]'

export type ToastType = 'error' | 'info' | 'pending' | 'success'

export type ToastAction = Readonly<{ label: string; onClick: () => void }>

export type Toast = Readonly<{
  id: string
  message: string
  type: ToastType
  /** inline buttons on the toast's own line — the toast grows, never stacks (owner 2026-08-21) */
  actions?: readonly ToastAction[]
  persistent?: boolean
}>

type ToastEvent = Readonly<{ type: 'show'; toast: Toast } | { type: 'remove'; id: string }>
type Listener = (event: ToastEvent) => void

const listeners = new Set<Listener>()
const emit = (event: ToastEvent): void => listeners.forEach((listener) => listener(event))
const message_of = (message: unknown): string =>
  typeof message === 'string' ? message : message instanceof Error ? message.message : 'Something went wrong'

/** The Sui SDK's gas-refusal vocabulary — a failed ATTEMPT is the only trigger for the
 *  top-up prompt (never a balance poll: first logins stay unbothered). */
const GAS_EMPTY_PATTERN = /gas coin|no valid gas|insufficientgas|gasbalancetoolow|unable to select a gas/i
const gas_empty_cell: { listener: (() => void) | null } = { listener: null }
/** Registered by the session observer (injection breaks the store↔toast cycle). */
export const on_gas_empty = (listener: (() => void) | null): void => {
  // eslint-disable-next-line functional/immutable-data -- the one injection cell of this module
  gas_empty_cell.listener = listener
}
const notice_gas_empty = (type: ToastType, message: string): void => {
  if (type === 'error' && GAS_EMPTY_PATTERN.test(message)) gas_empty_cell.listener?.()
}

const translate_cell: { translate: ((message: string) => string | null) | null } = { translate: null }
/** Registered by the session observer (it holds the localized copy): raw chain failures a
 *  player could never read — the version-gate abort, etc. — become honest player sentences.
 *  A translator returns null to leave a message untouched. Errors only. */
export const on_error_translate = (translate: ((message: string) => string | null) | null): void => {
  // eslint-disable-next-line functional/immutable-data -- the one injection cell of this module
  translate_cell.translate = translate
}
const translated = (type: ToastType, message: string): string =>
  (type === 'error' ? translate_cell.translate?.(message) : null) ?? message

const show = (toast: Toast): void => emit(Object.freeze({ type: 'show', toast }))
const remove = (id: string): void => emit(Object.freeze({ type: 'remove', id }))

export const toast = Object.freeze({
  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  },
  remove,
  add: (message: unknown, type: Exclude<ToastType, 'pending'> = 'error'): void => {
    const id = crypto.randomUUID()
    notice_gas_empty(type, message_of(message))
    show(Object.freeze({ id, message: translated(type, message_of(message)), type }))
    setTimeout(() => remove(id), 5_000)
  },
  persistent: (
    message: string,
    type: Exclude<ToastType, 'success'>,
    ...actions: readonly ToastAction[]
  ): (() => void) => {
    const id = crypto.randomUUID()
    show(Object.freeze({ id, message, type, actions: Object.freeze(actions), persistent: true }))
    return () => remove(id)
  },
  loading: (message: string) => {
    const id = crypto.randomUUID()
    show(Object.freeze({ id, message, type: 'pending', persistent: true }))
    const finish = (next: unknown, type: 'error' | 'success'): void => {
      notice_gas_empty(type, message_of(next))
      show(Object.freeze({ id, message: translated(type, message_of(next)), type }))
      setTimeout(() => remove(id), type === 'success' ? 1_400 : 5_000)
    }
    return Object.freeze({
      dismiss: () => remove(id),
      error: (error: unknown) => finish(error, 'error'),
      success: (success: string) => finish(success, 'success'),
    })
  },
})
