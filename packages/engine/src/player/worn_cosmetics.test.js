// Worn-cosmetic fit math — the sui_helmet measured-fit unit (legacy-authored assets mount RAW with no math at
// all — the aresrpg-legacy equip_hat/equip_cape mechanism; the mounting itself is three/GPU-bound and proven
// by bench/_worn_live_capture.spec.js on real hardware).

import { test, expect, describe, spyOn } from 'bun:test'
import { Bone, BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'

import { compute_worn_head_scale, create_worn_cosmetics, HEAD_FIT } from './worn_cosmetics.js'

function fake_glb(variant = 'black') {
  const scene = new Group()
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: 0xffffff }))
  mesh.name = 'cosmetic_mesh'
  mesh.userData.gltfExtensions = {
    KHR_materials_variants: { mappings: [{ material: 1, variants: [0] }] },
  }
  scene.add(mesh)
  const black = new MeshStandardMaterial({ color: 0x010203 })
  return {
    scene,
    parser: {
      json: { extensions: { KHR_materials_variants: { variants: [{ name: variant }] } } },
      getDependency: async (kind, index) => {
        expect([kind, index]).toEqual(['material', 1])
        return black
      },
    },
  }
}

async function wait_for_mount(worn, slot) {
  for (let i = 0; i < 100 && !worn.mounted()[slot]; i += 1) await Bun.sleep(1)
  return worn.mounted()[slot]
}

describe('compute_worn_head_scale — outer width = head width × WOVER', () => {
  test('fits the cosmetic to the head by the WIDER horizontal dim', () => {
    // head 0.5 wide, helmet raw 1.0 wide, WOVER 1.4 → scale 0.7 (0.5·1.4 / 1.0)
    expect(compute_worn_head_scale({ x: 0.5, z: 0.4 }, { x: 1.0, z: 0.8 }, 1.4)).toBeCloseTo(0.7, 5)
  })

  test('the wider of x/z drives BOTH head and mesh (a deep-but-narrow helmet still clears the skull)', () => {
    // head wider in z (0.6), mesh wider in x (2.0), WOVER 1 → 0.6/2.0 = 0.3
    expect(compute_worn_head_scale({ x: 0.3, z: 0.6 }, { x: 2.0, z: 0.5 }, 1)).toBeCloseTo(0.3, 5)
  })

  test('a zero-width mesh never divides by zero (guarded → head width × WOVER)', () => {
    expect(compute_worn_head_scale({ x: 0.5, z: 0.5 }, { x: 0, z: 0 }, 1.4)).toBeCloseTo(0.7, 5)
  })

  test('the approved default WOVER is 1.4 (chibi overhang, sui_showcase 2026-07-12b)', () => {
    expect(HEAD_FIT.wover).toBe(1.4)
    expect(HEAD_FIT.vadj).toBe(0.35)
  })
})

describe('create_worn_cosmetics — live rig reconciliation', () => {
  test('a variant-bearing cape spec mounts on the cape bone and unmounts when the slot clears', async () => {
    const root = new Group()
    const cape = new Bone()
    cape.name = 'mixamorigCape'
    root.add(cape)
    const worn = create_worn_cosmetics({
      avatar: { object3d: root, ready: true },
      load_model: async () => fake_glb(),
    })
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      worn.set_slots({ back: { url: '/cape_fuwa.glb', variant: 'black' } })
      expect(await wait_for_mount(worn, 'back')).toMatchObject({ bone: 'mixamorigCape', variant: 'black' })
      expect(cape.children).toHaveLength(1)
      expect(cape.children[0].rotation.x).toBeCloseTo(Math.PI, 5)
      const mesh = /** @type {any} */ (cape.children[0].getObjectByName('cosmetic_mesh'))
      expect(mesh.material.color.getHex()).toBe(0x010203)

      worn.set_slots({ back: null })
      expect(worn.mounted().back).toBeUndefined()
      expect(cape.children).toHaveLength(0)
    } finally {
      warn.mockRestore()
      worn.dispose()
    }
  })

  test('a late hair arrival cannot clear an already-mounted hat', async () => {
    const root = new Group()
    const head = new Bone()
    head.name = 'mixamorigHead'
    const original_hair = new Group()
    original_hair.name = 'original_hair'
    head.add(original_hair)
    root.add(head)
    const worn = create_worn_cosmetics({
      avatar: { object3d: root, ready: true },
      load_model: async () => fake_glb(),
    })

    worn.set_slots({ head: '/hat.glb' })
    expect(await wait_for_mount(worn, 'head')).toBeDefined()
    expect(original_hair.visible).toBe(false)

    // character_avatar's async hair callback currently performs head.clear() after avatar.ready.
    head.clear()
    const late_hair = new Group()
    late_hair.name = 'late_hair'
    head.add(late_hair)
    worn.set_slots({ head: '/hat.glb' })

    expect(late_hair.visible).toBe(false)
    expect(head.children).toHaveLength(2)

    worn.set_slots({ head: null })
    expect(late_hair.visible).toBe(true)
    expect(head.children).toEqual([late_hair])
    worn.dispose()
  })

  test('seed element aliases select the authored KHR variant', async () => {
    const root = new Group()
    const head = new Bone()
    head.name = 'Head'
    root.add(head)
    const worn = create_worn_cosmetics({
      avatar: { object3d: root, ready: true },
      load_model: async () => fake_glb('agility'),
    })
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      worn.set_slots({ head: { url: '/capuche_bara.glb', variant: 'air' } })
      expect(await wait_for_mount(worn, 'head')).toMatchObject({ variant: 'air' })
      const mesh = /** @type {any} */ (head.children[0].getObjectByName('cosmetic_mesh'))
      expect(mesh.material.color.getHex()).toBe(0x010203)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
      worn.dispose()
    }
  })

  test('an exact authored variant wins before the seed element alias', async () => {
    const root = new Group()
    const head = new Bone()
    head.name = 'Head'
    root.add(head)
    const worn = create_worn_cosmetics({
      avatar: { object3d: root, ready: true },
      load_model: async () => fake_glb('air'),
    })
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      worn.set_slots({ head: { url: '/exact.glb', variant: 'air' } })
      expect(await wait_for_mount(worn, 'head')).toMatchObject({ variant: 'air' })
      const mesh = /** @type {any} */ (head.children[0].getObjectByName('cosmetic_mesh'))
      expect(mesh.material.color.getHex()).toBe(0x010203)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
      worn.dispose()
    }
  })
})
