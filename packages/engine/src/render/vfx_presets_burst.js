// FLAGSHIP VFX — the BURST (impact-only) preset builders, split from vfx_presets_spell.js to keep every file
// ≤600 LoC. These are the strikes with NO windup/projectile (the swing/kill IS the beat):
//   • eruption_preset — the earth ground eruption (ExplosionFX molten chunks + billow + ElementalMagic ground ring)
//   • soul_preset     — the death KO = the REAL DarkMagicFX void orb (void_ball + void_core hole + streak corona +
//                       imploding void motes + the portal ground ring)
//   • slash_preset    — the weapon melee slash (BattleFX slash_arc crescent + a spark fan + gravity sparks)
// Each is a pure `s → VfxPreset` builder consumed by vfx_presets_spell.js's assembly. The appearance strings
// resolve in vfx_pack_shaders(2).js (the pack .gdshader ports). Colour law unchanged: brief bursts may run HDR
// cores (< the 2.05 no-halo threshold, engine unit-tested); sustained loops live in vfx_presets_spell.js.

/** @typedef {import('./vfx_preset_engine.js').VfxPreset} VfxPreset */
/** @typedef {import('./vfx_preset_engine.js').VfxEmitter} VfxEmitter */

/** @type {[number,number,number]} */
const HOT = [1, 1, 1]

// ── BURST: EARTH ERUPTION — a gold-loam pillar erupting UP from the target's feet (the ground-anchored strike).
/** @param {{ name:string, hot:[number,number,number], body:[number,number,number], deep:[number,number,number] }} s @returns {VfxPreset} */
export function eruption_preset(s) {
  return {
    name: s.name,
    duration: 1.4,
    flash: { color: s.hot, ms: 200 },
    emitters: [
      // PILLAR — a fast narrow cone of chunks blasting straight up, then falling under gravity (the eruption body).
      {
        name: 'pillar',
        count: 30,
        lifetime: 0.9,
        explosiveness: 1,
        shape: 'cone',
        offset: [0, 0.4, 0],
        direction: [0, 1, 0],
        spread: 22,
        speed: [11, 20],
        gravity: [0, -16, 0],
        drag: 1.2,
        size: [0.6, 1.4],
        size_curve: [1, 0.6],
        alpha_curve: [1, 0.9, 0],
        appearance: 'explo_ball', // ExplosionFX molten-noise body, loam-tinted → tumbling rock chunks
        color: s.hot,
        color_end: s.body,
      },
      // DEBRIS — sharp rock chunks arcing wider up+out then dropping (the shrapnel read): ExplosionFX explosion_bits
      // (the chunky rock BITS, mix(sec,pri,COLOR.a) bright→dark), not the generic FBM `spark` — cut EVERY non-Godot effect.
      {
        name: 'debris',
        count: 22,
        lifetime: 0.85,
        explosiveness: 1,
        shape: 'cone',
        offset: [0, 0.3, 0],
        direction: [0, 1, 0],
        spread: 60,
        speed: [8, 15],
        gravity: [0, -18, 0],
        size: [0.3, 0.7],
        size_curve: [1, 0.4],
        alpha_curve: [1, 0],
        appearance: 'explo_bits', // ExplosionFX explosion_bits.gdshader — the real rock chunks (was generic 'spark')
        color: s.body,
        color_end: s.deep,
      },
      // DUST — a low rising cloud of loam around the base, softening the eruption.
      {
        name: 'dust',
        count: 24,
        lifetime: 1.3,
        explosiveness: 1,
        shape: 'sphere',
        radius: 0.9,
        offset: [0, 0.4, 0],
        speed: [1.4, 3.2],
        gravity: [0, 1.4, 0],
        drag: 1.6,
        size: [1.2, 2.6],
        size_curve: [0.5, 1, 0.95],
        alpha_curve: [0.55, 0.4, 0],
        appearance: 'explo_smoke', // ExplosionFX billow, loam-tinted → the rising dust cloud
        color: s.body,
        color_end: s.deep,
        opacity: 0.5,
      },
      // RING — the eruption's shock ring: the pack's OWN ExplosionFX explosion_rings (was cross-pack ElementalMagic
      // elem_area — an exactness violation; the eruption is ExplosionFX molten chunks + billow, so its ring is too).
      // blend_add + emission 4, matching every other ExplosionFX shock ring — a punchy gold shock, not a flat disc.
      {
        name: 'ring',
        count: 1,
        lifetime: 0.8,
        explosiveness: 1,
        shape: 'point',
        offset: [0, 0.08, 0],
        size: [3.4, 3.4],
        size_curve: [0.5, 2.4],
        alpha_curve: [0.85, 0],
        appearance: 'explo_rings', // ExplosionFX explosion_rings (pack render_mode blend_add) — same family as pillar/debris/dust
        blend: 'additive',
        color: s.hot,
        color_end: s.body,
        emission: 4,
      },
    ],
  }
}

// ── BURST: DEATH = the REAL DarkMagicFX VOID orb (fixes a flat sprite that read as "dark magic looks
// completely different"). Faithful to vfx_ball_void_01.tscn: a displaced magenta ENERGY SPHERE (void_ball) with a
// BLACK fresnel VOID CORE punched through its centre (void_core — the signature hole), the void_aura streak-wave
// CORONA, imploding VOID MOTES, an area_dark ground pool, and a glow-bloom flash. `primary` ≡ color (magenta),
// `secondary` ≡ color_end (blue) — the pack colour model. Emission carries the glow (normal-blend AgX-safe idiom).
/** @param {{ name:string, hot:[number,number,number], body:[number,number,number], deep:[number,number,number] }} s @returns {VfxPreset} */
export function soul_preset(s) {
  return {
    name: s.name,
    duration: 1.3,
    flash: { color: s.hot, ms: 200 },
    emitters: [
      // FLASH — the VFXOmniLightBB magenta light bloom (glow.gdshader on a sphere), the instant the void tears open.
      {
        name: 'flash',
        count: 1,
        lifetime: 0.35,
        explosiveness: 1,
        shape: 'point',
        offset: [0, 0.7, 0],
        size: [2, 2],
        size_curve: [0.6, 1.4],
        alpha_curve: [1, 0.5, 0],
        appearance: 'sphere_glow', // the VFXOmniLightBB magenta light bloom (glow.gdshader) — NOT a cross-pack star4
        color: s.hot,
        color_end: s.body,
        emission: 3,
      },
      // ORB — the void_ball: a displaced magenta→blue energy sphere (the pack's hero). Grows in, holds, fades.
      {
        name: 'orb',
        count: 1,
        lifetime: 1.2,
        offset: [0, 0.7, 0],
        size: [1.5, 1.5],
        size_curve: [0.3, 1.05, 1, 0.9],
        alpha_curve: [0, 1, 0.9, 0],
        appearance: 'void_ball',
        displace: 0.5,
        color: s.body, // primary magenta
        color_end: s.deep, // secondary blue
        emission: 2.6,
      },
      // VOID CORE — the black fresnel hole punched through the orb's centre (void_core), rendered IN FRONT.
      {
        name: 'void',
        count: 1,
        lifetime: 1.2,
        offset: [0, 0.7, 0],
        size: [1.02, 1.02],
        size_curve: [0.3, 1.05, 1, 0.9],
        alpha_curve: [0, 1, 0.95, 0],
        appearance: 'void_core',
        displace: 0.5,
        color: HOT,
      },
      // CORONA — the orb's OWN void_aura.gdshader (the Aura node): radial streak-waves. NOT the cross-pack streaks.
      {
        name: 'corona',
        count: 1,
        lifetime: 1.1,
        explosiveness: 1,
        shape: 'point',
        offset: [0, 0.7, 0],
        size: [4.2, 4.2],
        size_curve: [0.5, 1.1, 1],
        alpha_curve: [0, 0.9, 0.5, 0],
        appearance: 'void_aura', // the Aura MeshInstance's OWN void_aura.gdshader — NOT cross-pack StylizedHitFX streaks
        color: s.body, // primary magenta
        color_end: s.deep, // secondary blue (matches vfx_ball_void_01 void_aura primary/secondary)
        emission: 2.4,
        opacity: 0.9,
      },
      // MOTES — imploding void particles (void_particles.gdshader): dark energy sucked toward the core.
      {
        name: 'motes',
        count: 22,
        lifetime: 0.7,
        explosiveness: 0.6,
        shape: 'shell',
        radius: 2.2,
        inward: true,
        offset: [0, 0.7, 0],
        speed: [3.5, 5],
        drag: 1.2,
        size: [0.5, 1.1],
        size_curve: [1, 0.3],
        alpha_curve: [0, 1, 0],
        appearance: 'void_particle', // noise 0.3 (was 2× too dense) — the real void_particles.gdshader
        color: s.body, // primary magenta
        color_end: s.deep, // secondary blue (the scene's void_particles primary/secondary)
        emission: 2.2,
      },
      // GROUND POOL — the REAL DarkMagicFX area_dark.gdshader: a rippling dark shadow zone (blend_mix darken).
      {
        name: 'portal',
        count: 1,
        lifetime: 1.0,
        explosiveness: 1,
        shape: 'point',
        offset: [0, 0.08, 0],
        size: [3.6, 3.6],
        size_curve: [0.4, 1.2, 1],
        alpha_curve: [0, 0.9, 0],
        appearance: 'area_dark', // the REAL DarkMagicFX area_dark.gdshader dark pool — replaces the fabricated portal()
        color: s.body,
        color_end: s.deep,
        emission: 2.4,
      },
    ],
  }
}

// ── BURST: WEAPON SLASH — the BattleFX vfx_blank_slash beat: the slash_arc CRESCENT (Slash node) + arcane_mote
// PARTICLES (attack_particles, the Particles node), neutral steel grey. No windup/projectile — the swing IS the beat.
/** @param {{ name:string, hot:[number,number,number], body:[number,number,number] }} s @returns {VfxPreset} */
export function slash_preset(s) {
  return {
    name: s.name,
    duration: 0.9,
    flash: { color: s.hot, ms: 150 },
    emitters: [
      // SWEEP — a flat wide fan of arcane_mote particles sweeping across (the attack_particles fan), fast + short.
      {
        name: 'slash',
        count: 30,
        lifetime: 0.35,
        explosiveness: 1,
        shape: 'box',
        radius: 0.4,
        offset: [0, 0.6, 0],
        direction: [1, 0.15, 0],
        spread: 26,
        speed: [12, 20],
        drag: 3,
        size: [0.4, 1],
        size_curve: [1, 0.3],
        alpha_curve: [1, 0.9, 0],
        appearance: 'arcane_mote', // BattleFX attack_particles.gdshader — NOT a generic spark
        color: s.hot,
        color_end: s.body,
        spin: 2,
      },
      // ARC — the real BattleFX slash.gdshader CRESCENT sweeping across the strike (the blade arc itself),
      // bright core → weapon-red edge. A single shaped billboard, not a spark fan (the "+ the slash arc" port).
      {
        name: 'arc',
        count: 1,
        lifetime: 0.32,
        explosiveness: 1,
        shape: 'point',
        offset: [0, 0.6, 0],
        size: [3.4, 3.4],
        size_curve: [1.2, 0.5],
        alpha_curve: [1, 0.7, 0],
        appearance: 'slash_arc',
        color: HOT,
        color_end: s.body,
        emission: 2,
        spin: 0.5,
      },
      // MOTES — a few gravity arcane_mote bits flung off the strike (the attack_particles spray).
      {
        name: 'sparks',
        count: 14,
        lifetime: 0.5,
        explosiveness: 1,
        shape: 'sphere',
        radius: 0.2,
        offset: [0, 0.6, 0],
        spread: 180,
        speed: [6, 11],
        gravity: [0, -12, 0],
        size: [0.25, 0.55],
        size_curve: [1, 0],
        alpha_curve: [1, 0],
        appearance: 'arcane_mote', // BattleFX attack_particles.gdshader — NOT a generic spark
        color: s.hot,
        color_end: s.body,
      },
    ],
  }
}

// ── BURST: WEAPON STRIKE — the LEAN StylizedHitFX strike beat. vfx_strike_01.tscn is only 3 visible nodes
// (GPUParticles3D2=streaks + HitCore=four_point_star + VFXOmniLightBB), NOTHING like the 7-emitter hit_preset the
// port wrongly routed it through (audit #2). The melee weapon-swing impact: a swirling streak corona + a sharp
// growing 4-point star. The VFXOmniLightBB is energy 0 (near-off, anim-keyed) so there's NO bloom — the streaks +
// star ARE the beat. `accent` = the .tscn secondary_color / OmniLight light_color (gold=strike_01, ice=02, red=03,
// mag=04 — verified exact). White cores; the accent is the edge/rim tint.
/** @param {{ name:string, duration:number, accent:[number,number,number] }} s @returns {VfxPreset} */
export function strike_preset(s) {
  const WHITE = /** @type {[number,number,number]} */ ([1, 1, 1])
  return {
    name: s.name,
    duration: s.duration,
    flash: { color: s.accent, ms: 150 },
    emitters: [
      // STREAKS — the swirling angular corona (streaks.gdshader, the GPUParticles3D2 node), white core → accent edge.
      {
        name: 'streaks',
        count: 1,
        lifetime: 0.3,
        explosiveness: 0.9,
        shape: 'point',
        offset: [0, 0.5, 0],
        size: [3.6, 3.6],
        size_curve: [0.4, 1.1, 0.9],
        alpha_curve: [0.9, 0.5, 0],
        appearance: 'streaks',
        color: WHITE,
        color_end: s.accent,
        emission: 2.6,
        spin: 0.4,
      },
      // STAR — the sharp four_point_star burst (the HitCore node), growing 3→5: the crisp weapon-hit spark.
      {
        name: 'star',
        count: 1,
        lifetime: 0.45,
        explosiveness: 1,
        shape: 'point',
        offset: [0, 0.5, 0],
        size: [3, 4.8],
        size_curve: [0.6, 1, 1.4],
        alpha_curve: [1, 0.7, 0],
        appearance: 'star4',
        color: WHITE,
        color_end: s.accent,
        emission: 2.4,
        spin: 0.2,
      },
    ],
  }
}
