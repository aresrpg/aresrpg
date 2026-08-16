// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const TOAST_CONTAINER_CLASS =
  'fixed top-[max(1rem,var(--safe-top))] right-[max(1rem,var(--safe-right))] z-[300] flex max-h-[calc(100dvh-max(1rem,var(--safe-top))-max(1rem,var(--safe-bottom)))] max-w-[min(24rem,calc(100vw-max(1rem,var(--safe-left))-max(1rem,var(--safe-right))))] flex-col items-end gap-2 overflow-hidden'

export const toast_glass_class =
  'flex flex-col gap-2 p-4 border border-white/10 bg-black/70 backdrop-blur-md rounded-[7px] animate-[slide-in_0.3s_ease-out]'

export type ToastType = 'error' | 'info' | 'pending' | 'success'

export type Toast = Readonly<{
  id: string
  message: string
  type: ToastType
  action?: Readonly<{ label: string; onClick: () => void }>
  persistent?: boolean
}>

type ToastEvent = Readonly<{ type: 'show'; toast: Toast } | { type: 'remove'; id: string }>
type Listener = (event: ToastEvent) => void

const listeners = new Set<Listener>()
const emit = (event: ToastEvent): void => listeners.forEach((listener) => listener(event))
const message_of = (message: unknown): string =>
  typeof message === 'string' ? message : message instanceof Error ? message.message : 'Something went wrong'

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
    show(Object.freeze({ id, message: message_of(message), type }))
    setTimeout(() => remove(id), 5_000)
  },
  persistent: (message: string, type: Exclude<ToastType, 'success'>, action?: Toast['action']): (() => void) => {
    const id = crypto.randomUUID()
    show(Object.freeze({ id, message, type, action, persistent: true }))
    return () => remove(id)
  },
  loading: (message: string) => {
    const id = crypto.randomUUID()
    show(Object.freeze({ id, message, type: 'pending', persistent: true }))
    const finish = (next: unknown, type: 'error' | 'success'): void => {
      show(Object.freeze({ id, message: message_of(next), type }))
      setTimeout(() => remove(id), type === 'success' ? 1_400 : 5_000)
    }
    return Object.freeze({
      dismiss: () => remove(id),
      error: (error: unknown) => finish(error, 'error'),
      success: (success: string) => finish(success, 'success'),
    })
  },
})
