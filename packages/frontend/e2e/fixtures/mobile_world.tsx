// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { TouchControls, type TouchDevice } from '../../../mobile/src/TouchControls.tsx'
import { MobPackCard } from '../../src/components/MobPackCard.tsx'
import { NametagCard } from '../../src/components/NametagCard.tsx'
import { PromptText } from '../../src/components/PromptChip.tsx'
import { ContextMenu } from '../../src/components/ContextMenu.tsx'
import { MountPrompt } from '../../src/components/MountPrompt.tsx'
import { PortalPrompt } from '../../src/components/PortalPrompt.tsx'
import { publish_mount_prompt } from '../../src/game/core/mount_prompt_feed.ts'
import { publish_portal_prompt } from '../../src/game/core/portal_prompt_feed.ts'
import { create_camera_drag } from '../../src/game/core/camera_drag.ts'
import { attach_context_menu_input } from '../../src/game/core/context_menu_input.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import '../../src/tailwind.css'
import '../../../ui/src/inspection.css'

const copy = await load_app_copy('en')
const controls_only = new URLSearchParams(location.search).has('controls')
const device: TouchDevice = {
  set_movement: (axes) => {
    document.body.dataset.movement = JSON.stringify(axes)
  },
  set_jump: () => {},
}

const Probe = () => {
  const canvas = useRef<HTMLCanvasElement>(null)
  const mount = useRef<HTMLDivElement>(null)
  const portal = useRef<HTMLDivElement>(null)
  const [action, set_action] = useState('')
  const [menu, set_menu] = useState<Readonly<{ x: number; y: number }> | null>(null)
  useEffect(() => {
    const controls = create_camera_drag({
      on_rotate: (dx, dy) => {
        set_action('rotate')
        document.body.dataset.rotationX = String(Number(document.body.dataset.rotationX ?? 0) + dx)
        document.body.dataset.rotationY = String(Number(document.body.dataset.rotationY ?? 0) + dy)
      },
    })
    controls.attach(canvas.current!)
    const detach = attach_context_menu_input(canvas.current!, (event) => {
      event.preventDefault()
      set_menu({ x: event.clientX, y: event.clientY })
    })
    let riding = false
    const toggle_mount = () => {
      riding = !riding
      set_action(riding ? 'mount' : 'dismount')
      publish_mount_prompt({ root: mount.current!, riding, activate: toggle_mount })
    }
    publish_mount_prompt({ root: mount.current!, riding, activate: toggle_mount })
    publish_portal_prompt({ root: portal.current!, activate: () => set_action('travel') })
    return () => {
      detach()
      controls.detach()
      publish_mount_prompt(null)
      publish_portal_prompt(null)
    }
  }, [])
  return (
    <main className={controls_only ? 'fixed inset-0 bg-bg text-text' : 'bg-bg p-4 text-text'}>
      <output aria-label="Last action">{action}</output>
      <div className="flex items-end gap-4 pt-20">
        <MobPackCard members={[]} copy={copy} active activate={() => set_action('attack')} />
        <NametagCard
          name="Wood"
          lines={[
            {
              key: 'gather',
              activate: () => set_action('gather'),
              text: (
                <PromptText template="Press {{key}} to gather Wood" touch_template="Tap to gather Wood" label="F" />
              ),
            },
            {
              key: 'all',
              activate: () => set_action('all'),
              text: (
                <PromptText
                  template={copy.world_hud.resource_press_collect_all!}
                  touch_template={copy.world_hud.resource_press_collect_all_touch!}
                  label="R"
                />
              ),
            },
          ]}
        />
        <div ref={mount} />
        <div ref={portal} />
      </div>
      <MountPrompt copy={copy} />
      <PortalPrompt copy={copy} />
      <canvas
        aria-label="Character"
        width={500}
        height={200}
        ref={canvas}
        className={controls_only ? 'absolute inset-0 size-full bg-surface-high' : 'bg-surface-high'}
      />
      {controls_only && <TouchControls copy={copy} device={device} />}
      {menu && (
        <ContextMenu {...menu}>
          <button
            role="menuitem"
            type="button"
            className="min-h-11 p-3"
            onClick={() => {
              set_action('invite')
              set_menu(null)
            }}
          >
            Invite to group
          </button>
        </ContextMenu>
      )}
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Probe />)
