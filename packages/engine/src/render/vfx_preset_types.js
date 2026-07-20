// FLAGSHIP VFX — the preset TYPE surface (JSDoc typedefs, erased at runtime). Split out of vfx_preset_engine.js so
// that file stays ≤600 LoC; the engine re-aliases these, so every `import('./vfx_preset_engine.js').Vfx*` keeps working.

/**
 * @typedef {object} VfxEmitter
 * @property {string} [name]
 * @property {number} count particles
 * @property {number} lifetime seconds each particle lives
 * @property {number} [explosiveness] 0..1 (1 = all born at t0; <1 spreads births over lifetime)
 * @property {number} [delay] seconds before this emitter's particles begin (the pack's emit_start — a staggered second wave)
 * @property {'point'|'sphere'|'shell'|'cone'|'ring'|'box'} [shape] emission volume ('shell' = sphere SURFACE at radius)
 * @property {number} [radius] sphere/shell/ring/box extent
 * @property {[number,number,number]} [emission_scale] per-axis multiplier on the SPHERE emission volume (Godot emission_shape_scale) — a vertical ellipsoid body-hugging cloud (StatusFX auras 0.5,1,0.5); default [1,1,1]
 * @property {[number,number]} [radial] initial radial velocity min/max, outward from the emission centre (Godot radial_velocity)
 * @property {number} [radial_accel] constant radial acceleration (Godot radial_accel); signed — negative CONVERGES on the centre (the gem/heal/magic/void inward pull)
 * @property {number} [inner] ring inner radius
 * @property {[number,number,number]} [offset] emission centre offset
 * @property {[number,number,number]} [direction] cone axis
 * @property {number} [spread] cone half-angle degrees (≥180 ⇒ isotropic)
 * @property {boolean} [inward] launch TOWARD the emission centre (Godot negative radial_accel) — the "charge"/gather look
 * @property {number} [orbit] angular velocity (rad/s) revolving the XZ position around the vertical axis through `offset` (Godot orbit_velocity); 0/absent = ballistic (untouched)
 * @property {[number,number,number]} [ellipsoid] sphere-hero per-axis half-extents [rx,ry,rz] (the aura capsule); overrides the uniform `size` radius
 * @property {boolean} [trail] world-space wake: a moving emitter's particle stays where it was BORN (world -= travel·age), so a flying orb leaves a trail instead of rigidly dragging the puff
 * @property {[number,number]} [speed] initial velocity min/max
 * @property {[number,number,number]} [gravity] constant accel (blocks/s²)
 * @property {number} [drag] exponential drag coefficient (from Godot damping)
 * @property {[number,number]} [size] base world-size min/max (mesh extent × Godot scale)
 * @property {number[]} [size_curve] size multiplier control points over life
 * @property {number[]} [alpha_curve] alpha control points over life
 * @property {[number,number,number]} [color] start colour — also the PACK `primary` (bright core) for pack appearances
 * @property {[number,number,number]} [color_end] end colour — also the PACK `secondary` (edge) for pack appearances (default = color)
 * @property {'flame'|'ring'|'spark'|'glow'|'star'|'star4'|'streaks'|'flare'|'impact_core'|'impact_slash'|'spiral_dust'|'fire'|'void_particle'|'void_aura'|'area_dark'|'dark_ring'|'dark_lift'|'dark_glow'|'dark_flares'|'trail_blade'|'void_ball'|'void_core'|'sphere_glow'|'sphere_impact'|'elem_orb'|'elem_tail'|'elem_streak'|'elem_mote'|'elem_flare'|'elem_area'|'area_glow'|'zap'|'zap_burst'|'arcane_mote'|'slash_arc'|'explo_ball'|'explo_smoke'|'explo_core'|'explo_impact'|'explo_bits'|'explo_trails'|'explo_rings'|'smoke_trail'|'aura_mote'|'ice_flake'|'bubble'|'heal_cross'|'noise_mote'|'sleep_z'|'aura_shell'} [appearance] the look — generic (flame/smoke/ring/spark/glow/star) OR a REAL pack .gdshader port: phase-A (fire/star4/streaks/flare/impact_core/void_aura/area_dark/void_particle/trail_blade billboards; void_ball/void_core/sphere_glow/sphere_impact SPHERE heroes) + phase-B (ElementalMagic elem_*; Electric zap/zap_burst; Battle arcane_mote/slash_arc; Explosion explo_ball/smoke/core/impact/bits/trails/rings + smoke_trail; Status aura_mote/ice_flake/bubble/heal_cross/noise_mote/sleep_z; aura_shell capsule) + phase-B2 (StylizedHit impact_slash/spiral_dust; ElementalMagic area_glow; DarkMagic dark_ring/dark_lift/dark_glow/dark_flares). Default flame.
 * @property {number} [emission] pack colour-model brightness (× the mix(secondary,primary,value)); default 2
 * @property {number} [speed] animation-clock multiplier for the pack shader churn (noise scroll / wobble); default 1
 * @property {'sphere'} [geometry] mount a SphereMesh hero (real normals) instead of a billboard — auto for aura_shell/void_ball/void_core/sphere_* appearances
 * @property {number} [displace] sphere-hero vertex displacement amount (Godot displacement_amount); default 0.5
 * @property {number} [opacity] emitter master opacity
 * @property {number} [spin] max rotation speed rad/s
 * @property {'normal'|'additive'} [blend] default normal (AgX-safe)
 */
/**
 * @typedef {object} VfxPreset
 * @property {string} name
 * @property {number} duration seconds until full teardown (a LOOP preset runs until the caller disposes; `duration` is only the demo/bench age ceiling then)
 * @property {boolean} [loop] PERSISTENT emitter: each particle's age WRAPS its lifetime (continuous rebirth) — auras / status blooms / lingering remnants. One-shot presets omit it (untouched).
 * @property {{ color:[number,number,number], ms:number }} [flash] metadata (realised as a short core emitter)
 * @property {VfxEmitter[]} emitters
 */
/**
 * @typedef {object} VfxHandle
 * @property {import('three').Group} object3d add via engine.add_to_scene; positioned at the spawn point by the caller.
 * @property {*} age uniform(float) — seconds since spawn (the runtime advances it).
 * @property {*} origin uniform(Vector3) — the emitter's world spawn point; SET it per-frame to move the whole system (moving-emitter primitive).
 * @property {*} travel uniform(Vector3) — the emitter's current travel velocity; SET it alongside `origin` so `trail` emitters shed a world-static wake.
 * @property {number} scale the world-size multiplier baked into the seeds (magnitude); mirrored on object3d.userData.
 * @property {number} duration total seconds (a LOOP handle ignores it — dispose to stop).
 * @property {boolean} loop persistent (never self-expires on duration).
 * @property {number} particle_count total particles across emitters.
 * @property {number} draw_calls one per emitter.
 * @property {(dt:number)=>boolean} update advance age by dt; returns false once age>duration (one-shot) or always true (loop).
 * @property {()=>void} dispose free geometries + materials.
 */

export {}
