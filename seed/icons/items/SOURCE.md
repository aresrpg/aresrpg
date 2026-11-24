# Community title inventory icon provenance

Generated 2026-11-11 with built-in image generation.

All images use native transparent RGBA output, without chroma-key removal or hand-authored alpha masks. Each complete source was proportionally fitted within 450×450 pixels and centered on a transparent 512×512 canvas. The 64×64 runtime image was derived from that HD master with Pillow LANCZOS.

## title_frostlord

Files: `title_frostlord_hd.png` (512×512) and `title_frostlord.png` (64×64).

Reference: https://walrus.tusky.io/cSoHdxT0P49oeVfeVOgJwLXT7WwpTCeEOMaa9tMVWE8

## title_tater_champion

Files: `title_tater_champion_hd.png` (512×512) and `title_tater_champion.png` (64×64).

Reference: https://img.pawtato.app/hero/28827.png

## title_crew_member

Files: `title_crew_member_hd.png` (512×512) and `title_crew_member.png` (64×64).

Reference: Existing Blast Girl palette; seed/models/characters/blast_girl.glb

## title_chosen_one

Files: `title_chosen_one_hd.png` (512×512) and `title_chosen_one.png` (64×64).

Reference: https://assets.alienz.tech/collections/29a0f1cd164ad9789ae6c5370d94a5657da0188f96b59ea3d61a1e98a1f7464b/tokens/11009.png

## title_rootwarden

Files: `title_rootwarden_hd.png` (512×512) and `title_rootwarden.png` (64×64).

Reference: On-chain Rootlets samples, type 0x8f74a7d632191e29956df3843404f22d27bd84d92cca1b1abde621d033098769::rootlet::Rootlet

## title_aeonkeeper

Files: `title_aeonkeeper_hd.png` (512×512) and `title_aeonkeeper.png` (64×64).

Reference: Guardian #772 PNK; Sui object 0x015603b773dc8a36d547a40ca03e1ab19c2a6c60b4f8081389101f0b2e77d284

## title_suimilionaire

Files: `title_suimilionaire_hd.png` (512×512) and `title_suimilionaire.png` (64×64).

Reference: https://walrus.doonies.net/suimilios/2458.png

Revised 2026-11-11 using the owner-provided Milady/Remilio portrait reference. The collectible bust retains Suimilios brown fringe, dark reflective eyes with blue accents, and charcoal monster-knit clothing.

Export: native RGBA transparency; aspect-preserving fit inside 460×460 on a transparent 512×512 master, then LANCZOS reduction to 64×64. No background removal. Both sizes reviewed on light and dark surfaces.

## title_fudbuster

Files: `title_fudbuster_hd.png` (512×512) and `title_fudbuster.png` (64×64).

Reference: ipfs://QmY4aqfG34nVp7u57qGtuQsHWUv8horH7HK2DUNueLxXnu

## title_pug_paladin

Files: `title_pug_paladin_hd.png` (512×512) and `title_pug_paladin.png` (64×64).

Reference: ipfs://bafkreiedlak3aae6ohrjoo56fovjp26obzrkyvuthybin6yibuyvklkfvq

## title_enforcer

Files: `title_enforcer_hd.png` (512×512) and `title_enforcer.png` (64×64).

Reference: https://r2.nozomi.world/collections/machin/enforcer/images/6b2e9e4a22174d151e0bc6fcddb1e750.jpg

# Crew Helmet

Built-in generation with native transparent alpha. Master: 512×512; runtime: 64×64.

# Demo goblin equipment artwork

Built-in image generation; native transparent alpha. No chroma-key workaround.
HD masters: 512×512. Runtime images: 64×64, derived with Pillow LANCZOS.
Canonical files: `demo_goblin_{relic,ring,boots}{,_hd}.png` in this directory.

Asset: relic

Asset: ring

Asset: boots

# Muru equipment icons

Generated with the built-in image tool. Both outputs have native transparent alpha.
HD masters are 512×512; runtime icons are deterministic 64×64 Lanczos resizes.

Asset: Enka Muru

Asset: Zukin Muru

# Pampkin inventory icon

Mode: built-in image generation, native transparent RGBA.
Subject reference: Blender render of seed/models/pets/pampkin.glb.
Style references: oeuftermath_hd.png and zot_hd.png.
Master: pampkin_hd.png (512 × 512); runtime: pampkin.png (64 × 64).
Both sizes derived with Pillow LANCZOS from the generated RGBA source.

# Solomonk inventory icon

Native transparent RGBA generation; no chroma-key workaround.

Canonical master: `solomonk_hd.png` (512px). Runtime: `solomonk.png` (64px), derived with Lanczos resize.

Subject reference: the authored Solomonk model render from `misc/models/icons/solomonk.png`. Style reference: `seed/icons/mobs/demo_goblin_1_hd.png`.

# ACT partner drop artwork provenance

## helios_warlord__vesper

Files: `helios_warlord__vesper_hd.png` (512×512) and `helios_warlord__vesper.png` (64×64).

Generated: 2026-11-24.

Mode: built-in image generation, native transparent RGBA. No chroma-key workaround.

Reference: ACT master model supplied by the ACT team (2024-10-11); `seed/models/equipment/helios_warlord.glb`, material variant `vesper`; editable source `seed/models/sources/helios_warlord/helios_warlord.blend`. Subject render: `helmet_vesper.png`.

Style reference: `crew_helmet_hd.png` and `title_enforcer_hd.png`. Color variants preserve the generated Vesper geometry and pose.

Source: generated image artifact `exec-cd0f8bbd-5706-4607-adde-8fd0023165de.png`.

Export: transparent-margin crop, aspect-preserving fit within 450×450, centered on a transparent 512×512 master. Each family uses one shared crop rectangle. Runtime derived from its master with Pillow LANCZOS; generated alpha retained without masking.

Generation: 1 initial attempt; no regenerations.

Final prompt:

> Use case: style-transfer. Create a single AresRPG inventory icon, Helios Warlord Vesper.
> Input 1 is the ACT subject/shape reference, a voxel model: translate its design into smooth chunky hand-painted 3D-cartoon art; do NOT preserve voxel cubes or stair-stepped edges. Inputs 2 and 3 are house STYLE references only.
> Subject: isolated closed full-face sci-fi samurai helmet, dark gunmetal shell, very wide upswept BLACK outer V crest with a smaller bright GOLD inner V crest, tall swept GOLD central fin, a small RED gem at brow centre; dark shield visor with one glowing CYAN horizontal slit; round comms disc with gold centre and a thin upright antenna on viewer's right; three layered neck-guard plates with gold trim. Match the subject reference proportions and three-quarter angle: face turned slightly toward viewer's left, visible right side, modest top view. No wearer, shoulders or body.
> Style: bold hand-painted 3D-cartoon inventory art like crew_helmet_hd and title_enforcer_hd: chunky broad planar facets, crisp dark contour, broad deliberate highlights, restrained cool rim light, controlled colors. Smooth clean non-voxel silhouette. Preserve complete crest tips, fin, antenna and neck guard. Keep surfaces broad enough to read at 64 pixels. No microtexture.
> Composition: one centered object on a square canvas, filling approximately 85% of width and height with generous empty margin and no clipping. Real transparent background and transparent corners. No cast shadow, ground, pedestal, scenery, badge, border, text, letters, logo or watermark. Render native RGBA transparency.

## helios_warlord__dusk

Files: `helios_warlord__dusk_hd.png` (512×512) and `helios_warlord__dusk.png` (64×64).

Generated: 2026-11-24.

Mode: built-in image generation, native transparent RGBA. No chroma-key workaround.

Reference: ACT master model supplied by the ACT team (2024-10-11); `seed/models/equipment/helios_warlord.glb`, material variant `dusk`; editable source `seed/models/sources/helios_warlord/helios_warlord.blend`. Subject render: `helmet_dusk.png`.

Style reference: `crew_helmet_hd.png` and `title_enforcer_hd.png`. Color variants preserve the generated Vesper geometry and pose.

Source: generated image artifact `exec-6793f751-60e7-4e7e-9efb-049290f5fca9.png`.

Export: transparent-margin crop, aspect-preserving fit within 450×450, centered on a transparent 512×512 master. Each family uses one shared crop rectangle. Runtime derived from its master with Pillow LANCZOS; generated alpha retained without masking.

Generation: 1 initial attempt; no regenerations.

Final prompt:

> Use case: precise-object-edit. Image 1 is the EDIT TARGET, the approved painted Helios Warlord Vesper icon. Image 2 is only the ACT Dusk color reference; its voxel style must NOT be copied.
> Make the Dusk colorway by changing ONLY materials/colors of image 1. Preserve exactly the existing helmet geometry, silhouette, three-quarter pose, orientation, framing, dark contour, facet layout, highlights, visor shape, every crest tip, fin, antenna, round comms disc and layered neck guard.
> Replace gunmetal shell with blue-grey steel. Keep the large outer V crest dark navy. Replace ALL gold areas (inner V crest, tall centre fin, neck trim, ear-disc centre, antenna tip) with saturated electric-blue metal. Visor slit is pale icy cyan. Retain the small RED brow gem. The shield visor remains very dark navy.
> Keep the same bold hand-painted 3D-cartoon inventory style, smooth non-voxel broad facets, crisp dark outline, controlled cool rim light. One complete isolated helmet, centered square composition with empty margins, no clipping.
> Real native RGBA transparent background and corners. No body, scenery, ground shadow, pedestal, text, letters, logos, watermark or border.

## helios_warlord__blood_ivory

Files: `helios_warlord__blood_ivory_hd.png` (512×512) and `helios_warlord__blood_ivory.png` (64×64).

Generated: 2026-11-24.

Mode: built-in image generation, native transparent RGBA. No chroma-key workaround.

Reference: ACT master model supplied by the ACT team (2024-10-11); `seed/models/equipment/helios_warlord.glb`, material variant `blood_ivory`; editable source `seed/models/sources/helios_warlord/helios_warlord.blend`. Subject render: `helmet_blood_ivory.png`.

Style reference: `crew_helmet_hd.png` and `title_enforcer_hd.png`. Color variants preserve the generated Vesper geometry and pose.

Source: generated image artifact `exec-b571ec48-8a47-4db5-89f0-d0ba728376a0.png`.

Export: transparent-margin crop, aspect-preserving fit within 450×450, centered on a transparent 512×512 master. Each family uses one shared crop rectangle. Runtime derived from its master with Pillow LANCZOS; generated alpha retained without masking.

Generation: 1 initial attempt; no regenerations.

Final prompt:

> Use case: precise-object-edit. Image 1 is the EDIT TARGET, approved painted Helios Warlord Vesper icon. Image 2 is only the ACT Blood Ivory palette reference; ignore its voxel rendering.
> Make a material/color-only variation of image 1: ivory WHITE armor shell, deep BLOOD-RED outer V crest, brighter blood-red inner V crest, red tall centre fin, red neck trim, red comms-disc centre, red antenna tip. Very dark visor, luminous CORAL-RED horizontal visor slit. Small GOLD gem centered on the brow.
> Preserve exactly the original silhouette, geometry, three-quarter angle, framing, facet arrangement, complete crest tips, antenna, fin, round ear disc and layered neck guard. Same helmet sculpt, same pose. Only the palette and physically corresponding reflections change.
> Bold hand-painted 3D-cartoon item art with chunky planar forms, broad soft-white highlights on ivory, crisp dark outlines, restrained cool rim lighting. No voxel cubes, pixel art, photorealistic microtexture.
> One centered helmet on square canvas, complete silhouette with empty margins. Native RGBA transparent background, no body, shoulders, shadow, scenery, ground, text, letters, logos, border or watermark.

## helios_warlord__kin

Files: `helios_warlord__kin_hd.png` (512×512) and `helios_warlord__kin.png` (64×64).

Generated: 2026-11-24.

Mode: built-in image generation, native transparent RGBA. No chroma-key workaround.

Reference: ACT master model supplied by the ACT team (2024-10-11); `seed/models/equipment/helios_warlord.glb`, material variant `kin`; editable source `seed/models/sources/helios_warlord/helios_warlord.blend`. Subject render: `helmet_kin.png`.

Style reference: `crew_helmet_hd.png` and `title_enforcer_hd.png`. Color variants preserve the generated Vesper geometry and pose.

Source: generated image artifact `exec-04be8c61-b3ec-47b1-8def-822f5e1e41f8.png`.

Export: transparent-margin crop, aspect-preserving fit within 450×450, centered on a transparent 512×512 master. Each family uses one shared crop rectangle. Runtime derived from its master with Pillow LANCZOS; generated alpha retained without masking.

Generation: 1 initial attempt; no regenerations.

Final prompt:

> Use case: precise-object-edit. Image 1 is the EDIT TARGET: approved painted Helios Warlord Vesper. Image 2 is only the ACT Kin palette/subject reference; do not copy its voxel style.
> Repaint image 1 into the rare, most precious KIN colorway without changing any geometry or pose. Replace ALL dark gunmetal armor shell panels with rich polished GOLD: crown, side armor, visor frame, layered neck guard, comms-disc outer housing and antenna shaft. Both the large outer V crest and the smaller inner V crest are polished BLACK metal, as is the tall central fin. Ear-disc centre, neck-guard edge trims and antenna tip are black. Keep the small red brow gem. Dark visor with a luminous ORANGE slit.
> Gold must look exceptionally precious: warm amber shadow planes, rich yellow-gold midtones, broad pale buttery highlights with small bright gleaming bevels; visually much more luxurious than the standard gunmetal Vesper. Retain restrained cool rim light and crisp dark outline. No extra ornaments, sparkles, particles or symbols.
> Lock the exact sculpt, three-quarter viewing angle, silhouette, framing, broad facet shapes, crest sizes, antenna, fin and layered neck guard of image 1. Same bold hand-painted 3D-cartoon inventory art. No voxel cubes or pixel art.
> One centered complete helmet on square canvas, empty margin, no clipping. Real native RGBA transparent background. No shoulders, body, scenery, ground shadow, pedestal, border, letters, text, logo or watermark.

## title_operator_vesper

Files: `title_operator_vesper_hd.png` (512×512) and `title_operator_vesper.png` (64×64).

Generated: 2026-11-24.

Mode: built-in image generation, native transparent RGBA. No chroma-key workaround.

Subject: ACT Airdrop Transponder: dark gunmetal body, black bumpers, amber-gold trim and six buttons, amber CRT screen with one circle and diagonal sweep line. The Operator title icon depicts the transponder, not a helmet.

Reference: `/private/tmp/claude-501/-Users-sceat--claude-spares-spare-I3lZPx/61475afc-a446-4044-bfae-1717e01b2beb/scratchpad/refs/transponder_orange_page.jpg`; only the large ACT Airdrop Transponder picture on the left is the subject reference. Marketplace page elements and lettering are excluded.

Style reference: `seed/icons/items/title_enforcer_hd.png` and `seed/icons/items/act_crate_hd.png`. All three variants share the Vesper transponder's three-quarter pose and shape.

Source: generated image artifact `exec-169ad5e8-213e-4629-b14b-982b0022b8c0.png`.

Export: shared transparent-margin crop `(333, 29, 921, 1158)` from the 1254×1254 sources; framing ignores isolated 1/255-alpha background noise without masking the subject. Aspect-preserving fit within 450×450, centered on a transparent 512×512 master. Runtime derived from its master with Pillow LANCZOS; native subject alpha retained.

Generation: 1 initial attempt; no regenerations.

Final prompt:

> Use case: style-transfer. Asset: AresRPG Vesper Operator title inventory icon.
> Input 1 is the SUBJECT reference: a marketplace screenshot. Use ONLY the large ACT Airdrop Transponder pictured on the LEFT. Ignore every page element and all lettering. Input 2, title_enforcer_hd.png, and input 3, act_crate_hd.png, are STYLE references only: bold hand-painted 3D-cartoon inventory art, crisp dark outlines and broad faceted highlights. They are not subjects to copy.
> Subject: ONE chunky rugged handheld radio transponder, upright tall rectangular thick rubber-armoured body, beveled shoulders, reinforced projecting corner bumpers, one short stubby antenna and a smaller second stub on top. Large square recessed glowing CRT screen in the upper half. Below it a small keypad with EXACTLY SIX blank raised buttons arranged in TWO ROWS of THREE. No additional buttons or symbols. Clear armoured bottom bumper.
> Vesper palette: dark GUNMETAL body, BLACK rubber bumpers, AMBER-GOLD trim and all six buttons, screen glowing AMBER. The screen contains ONLY a simple bright signal glyph: ONE CIRCLE with ONE DIAGONAL SWEEP LINE. No letters, words, numbers or logos anywhere.
> Pose: slight three-quarter view from above, showing the FRONT clearly and a little of its LEFT SIDE, following the transponder reference. Preserve the sturdy compact radio proportions; no helmet, face, limbs, stand or attached accessories.
> House style: smooth chunky sculpted forms with planar painted shading, controlled saturated accents, broad deliberate highlights, crisp dark contour, restrained cool rim light. NOT voxel, NOT pixel art, NOT photorealistic.
> One complete isolated centered subject on a square canvas, approximately 85% canvas height with clear empty margins around antenna and bumpers; entire silhouette visible. GENUINELY TRANSPARENT BACKGROUND with native alpha. No scenery, floor, ground shadow, external glow, frame, badge, text, watermark or page elements.

## title_operator_dusk

Files: `title_operator_dusk_hd.png` (512×512) and `title_operator_dusk.png` (64×64).

Generated: 2026-11-24.

Mode: built-in image edit (Vesper color variant), native transparent RGBA. No chroma-key workaround.

Subject: ACT Airdrop Transponder: blue-grey steel body, dark navy bumpers, electric blue trim and six buttons, electric blue CRT screen with one circle and diagonal sweep line. The Operator title icon depicts the transponder, not a helmet.

Reference: `/private/tmp/claude-501/-Users-sceat--claude-spares-spare-I3lZPx/61475afc-a446-4044-bfae-1717e01b2beb/scratchpad/refs/transponder_orange_page.jpg`; only the large ACT Airdrop Transponder picture on the left is the subject reference. Marketplace page elements and lettering are excluded.

Style reference: `seed/icons/items/title_enforcer_hd.png` and `seed/icons/items/act_crate_hd.png`. All three variants share the Vesper transponder's three-quarter pose and shape.

Edit target: generated Vesper transponder artifact `exec-169ad5e8-213e-4629-b14b-982b0022b8c0.png`; preserve its geometry and pose.

Source: generated image artifact `exec-acb921a7-dd0e-4d6e-bf90-bb3b90514dd5.png`.

Export: shared transparent-margin crop `(333, 29, 921, 1158)` from the 1254×1254 sources; framing ignores isolated 1/255-alpha background noise without masking the subject. Aspect-preserving fit within 450×450, centered on a transparent 512×512 master. Runtime derived from its master with Pillow LANCZOS; native subject alpha retained.

Generation: 1 initial attempt; no regenerations.

Final prompt:

> Use case: precise-object-edit. Asset: AresRPG Dusk Operator title inventory icon.
> Input 1 is the EDIT TARGET: the generated Vesper ACT Airdrop Transponder inventory icon. This exact radio establishes the whole family geometry.
> Change ONLY the materials and colors to Dusk: dark gunmetal body becomes BLUE-GREY STEEL with broad pale blue highlights; black rubber bumpers become DARK NAVY; every amber-gold trim piece, antenna collar and all six keypad buttons become ELECTRIC BLUE; the CRT screen and its single circle-with-diagonal-sweep-line glyph glow ELECTRIC BLUE instead of amber.
> Lock the EXACT silhouette, body shape, slight three-quarter pose, camera, left side visibility, two top stubs, screen shape and position, SIX blank buttons in TWO ROWS of THREE, reinforced corner bumpers, facet placement and image framing. Keep every component and edge in the same place. No added marks or details.
> Same bold hand-painted 3D-cartoon house style, crisp dark outline, broad faceted painted shading and restrained cool rim light. NOT voxel, NOT pixel art, NOT photorealism.
> One complete isolated centered transponder on the SAME square canvas with the SAME clear margins. GENUINELY TRANSPARENT BACKGROUND with native alpha. No letters, words, numbers, logos, scenery, ground shadow, external glow, frame, badge or watermark. The only screen mark is the existing circle with diagonal sweep line.

## title_operator_blood_ivory

Files: `title_operator_blood_ivory_hd.png` (512×512) and `title_operator_blood_ivory.png` (64×64).

Generated: 2026-11-24.

Mode: built-in image edit (Vesper color variant), native transparent RGBA. No chroma-key workaround.

Subject: ACT Airdrop Transponder: ivory white body, blood-red bumpers, trim and six buttons, coral-red CRT screen with one circle and diagonal sweep line. The Operator title icon depicts the transponder, not a helmet.

Reference: `/private/tmp/claude-501/-Users-sceat--claude-spares-spare-I3lZPx/61475afc-a446-4044-bfae-1717e01b2beb/scratchpad/refs/transponder_orange_page.jpg`; only the large ACT Airdrop Transponder picture on the left is the subject reference. Marketplace page elements and lettering are excluded.

Style reference: `seed/icons/items/title_enforcer_hd.png` and `seed/icons/items/act_crate_hd.png`. All three variants share the Vesper transponder's three-quarter pose and shape.

Edit target: generated Vesper transponder artifact `exec-169ad5e8-213e-4629-b14b-982b0022b8c0.png`; preserve its geometry and pose.

Source: generated image artifact `exec-f045bf8a-5d79-4ffa-ad40-0aa6f9b7fee4.png`.

Export: shared transparent-margin crop `(333, 29, 921, 1158)` from the 1254×1254 sources; framing ignores isolated 1/255-alpha background noise without masking the subject. Aspect-preserving fit within 450×450, centered on a transparent 512×512 master. Runtime derived from its master with Pillow LANCZOS; native subject alpha retained.

Generation: 1 initial attempt; no regenerations.

Final prompt:

> Use case: precise-object-edit. Asset: AresRPG Blood Ivory Operator title inventory icon.
> Input 1 is the EDIT TARGET: the generated Vesper ACT Airdrop Transponder inventory icon. This exact radio establishes the whole family geometry.
> Change ONLY the materials and colors to Blood Ivory: dark gunmetal body becomes IVORY WHITE with broad off-white highlights and soft warm-grey shaded facets; all black rubber armour and corner bumpers become deep BLOOD RED; every amber-gold trim piece, antenna collar and all six keypad buttons become BLOOD RED; the CRT screen and its single circle-with-diagonal-sweep-line glyph glow CORAL RED instead of amber. The two antenna rubber stubs also become blood red. Keep the crisp outline dark.
> Lock the EXACT silhouette, body shape, slight three-quarter pose, camera, left side visibility, two top stubs, screen shape and position, SIX blank buttons in TWO ROWS of THREE, reinforced corner bumpers, facet placement and image framing. Keep every component and edge in the same place. No added marks or details.
> Same bold hand-painted 3D-cartoon house style, crisp dark outline, broad faceted painted shading and restrained cool rim light. NOT voxel, NOT pixel art, NOT photorealism.
> One complete isolated centered transponder on the SAME square canvas with the SAME clear margins. GENUINELY TRANSPARENT BACKGROUND with native alpha. No letters, words, numbers, logos, scenery, ground shadow, external glow, frame, badge or watermark. The only screen mark is the existing circle with diagonal sweep line.

## act_crate

Files: `act_crate_hd.png` (512×512) and `act_crate.png` (64×64).

Generated: 2026-11-24.

Mode: built-in image generation, native transparent RGBA. No chroma-key workaround.

Reference: ACT master model supplied by the ACT team (2024-10-11); the kabuto crest and palette follow `seed/models/equipment/helios_warlord.glb` and `seed/models/characters/act_operator_vesper.glb`. The supply case is newly generated artwork, not a render of a crate model.

Style reference: `sui_crate_hd.png`; the generated Vesper helmet supplies the gold crest motif.

Source: generated image artifact `exec-35a4abf0-7b8e-4fa9-bcd4-abee2d6c67aa.png`.

Export: transparent-margin crop, aspect-preserving fit within 450×450, centered on a transparent 512×512 master. Each family uses one shared crop rectangle. Runtime derived from its master with Pillow LANCZOS; generated alpha retained without masking.

Generation: 1 initial attempt; no regenerations.

Final prompt:

> Use case: style-transfer. Create one AresRPG ACT partner loot-crate inventory icon.
> Input 1, sui_crate_hd.png, is a STYLE and broad COMPOSITION reference: bold hand-painted 3D-cartoon chest seen three-quarter from slightly above, visible front, right side and lid. Input 2, the painted Helios Warlord helmet, is a MOTIF reference only for its gold kabuto V crest and coherent material rendering.
> Subject: a military sci-fi armored supply-drop case, compact heavy rectangular dark NAVY shell with chunky bevels and reinforced angular corner armor. Electric BLUE light strips embedded along lid seams and vertical side channels. Restrained black/yellow HAZARD STRIPES on the reinforced corner guards. A small FOLDED ANTENNA mounted on top, visibly hinged and folded back along the lid. On the FRONT, one large bright GOLD kabuto V crest emblem: a sculpted wide upward-pointing two-armed samurai crest shape, no writing. The gold emblem is the main readable focal point. Broad uncluttered panels, sealed lid, strong latches, no dangling items.
> Style: same house hand-painted 3D-cartoon as sui_crate_hd: chunky faceted armor, broad painterly metal highlights, crisp dark outlines, restrained cool rim light, clean materials, readable at 64px. Smooth non-voxel surfaces. Dark navy and electric blue are dominant; gold emblem and small yellow hazard patches provide contrast.
> Composition: one complete centered isolated case on a square canvas, filling about 85%, full silhouette and antenna with empty margins.
> Native RGBA transparent background. NO letters, numbers, typography, brand logos, writing or watermark. NO ground plane, cast shadow, backdrop, scenery, people, debris, external frame or badge.

## nogas_cloak

Files: `nogas_cloak_hd.png` (512×512) and `nogas_cloak.png` (64×64).

Generated: 2026-11-24.

Mode: built-in image generation, native transparent RGBA. No chroma-key workaround.

Subject: a wearable lime-green cloth cloak cut into the flat NOGAS frog silhouette, with tired half-lidded cream eyes, a straight black mouth, a dark shoulder clasp, hanging fabric folds, and blue inner lining visible at one edge.

References: `nogas.site` (the large lime-green frog in the supplied website screenshot) and `seed/models/equipment/nogas_cloak.glb` (the supplied cloak-model screenshot). Page text and the darker shape on the right are excluded.

Style references: `seed/icons/items/crew_helmet_hd.png` and `seed/icons/items/helios_warlord__vesper_hd.png`.

Source: generated image artifact `exec-07269e60-bfd5-4d7d-a40e-017049e5d633.png`.

Export: transparent-margin crop `(210, 62, 1019, 1204)` from the 1254×1254 source; framing ignores isolated 1/255-alpha background noise without masking the subject. Aspect-preserving Pillow LANCZOS fit to 319×450, centered on a transparent 512×512 master. Runtime derived from its master with Pillow LANCZOS; native subject alpha retained.

Generation: 1 initial attempt; no regenerations.

Final prompt:

> Use case: style-transfer. Create one AresRPG inventory equipment icon: NOGAS cloak.
> Input 1 (nogas_site.jpg) is the SUBJECT IDENTITY reference: use only the big lime-green frog at the right, ignoring all website text and layout. Preserve the flat lime body silhouette, two rounded eye bumps, tired half-lidded cream eyes with small black pupils, one perfectly straight horizontal black mouth line, thick dark outline, stubby arms and splayed feet.
> Input 2 (nogas_cloak_model.png) is the GARMENT SHAPE reference: the left cloak shapes show the same frog worn flat on the back. Ignore the dark shape on the right. Translate the shape into painted cloth, never voxel geometry.
> Inputs 3 (crew_helmet_hd.png) and 4 (helios_warlord__vesper_hd.png) are STYLE references only: house hand-painted 3D-cartoon inventory art, bold clean forms, broad painterly highlights, controlled saturated colors, crisp dark outline, restrained cool rim light.
> Subject: one empty wearable cloak made of thin lime-green cloth cut into the NOGAS frog silhouette, hanging from a small dark shoulder clasp at the top. The tired cream eyes and absolutely straight black mouth are flat fabric markings. The cloak is broad and flat, with soft cloth folds concentrated at the hanging leg-shaped hems and a blue inner lining just visible along one turned edge. Make the fabric drape and thin folded edge clearly visible. Keep the face legible and the mouth straight. Small arm-shaped side tabs hang limply as cloth. This is a garment, not a living frog, plush toy, inflated body, mascot character or creature. No wearer, mannequin or body inside. Keep the subject mostly front-facing with a slight turn to reveal the lining and fabric thickness.
> Composition: one complete centered isolated cloak on a square canvas, all clasp and hems visible, filling roughly 85–88 percent with clear margins. Final asset is 512x512 with subject fitted within 450x450 and must read clearly when reduced to 64x64.
> GENUINELY TRANSPARENT BACKGROUND with native alpha. No letters, logos, text, watermarks, frame, badge, scenery, ground plane, cast shadow or external glow. NOT voxel, NOT pixel art, NOT photorealistic microtexture.
