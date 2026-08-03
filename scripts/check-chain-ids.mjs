#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// check-chain-ids.mjs — the hardcoded chain-id gate (docs/CODE_LAW.md commit tier).
//
// Live Sui object/package ids (0x + 64 hex chars) must never be hand-typed into source, tests, or
// config — they drift the moment a package republishes. Reads flow through the keyless `packages/rpc`
// `/v1` API; `@aresrpg/sdk/deployment` pins the live ids for tx pre-flight. This gate scans every
// shippable/tracked file for the id shape and fails on any occurrence that isn't either a SANCTIONED
// generated artifact (a CLI-written deployment/ceremony record — exact path, not a directory glob) or
// already tracked in the known-debt baseline below.
//
// Wired into scripts/check-constraints.sh (the green-check). Standalone: `node scripts/check-chain-ids.mjs`.
import fs from 'node:fs'
import path from 'node:path'
import { createHash as create_hash } from 'node:crypto'
import { spawnSync as spawn_sync } from 'node:child_process'
import { fileURLToPath as file_url_to_path } from 'node:url'

const script_path = file_url_to_path(import.meta.url)
const default_root = path.resolve(path.dirname(script_path), '..')
const id_re = /0x[0-9a-f]{64}/g
const ignored_segments = new Set(['.git', '.agents', '.codex', 'build', 'dist', 'node_modules', 'target'])
// The #1728 audit observed 269 baseline occurrences. origin/edge commit de3ca08c then deliberately
// retired one worn_render_path.test.js mock id; pin its reviewed 268-row successor so a matcher
// that goes blind cannot report the resulting count drop as an improvement.
const EXPECTED_BASELINE_ROWS = 268

// The V2 fight-replay corpus (commit d4ebe84c) — real historical chain traces converted by
// scripts/convert_fight_traces.mjs into provenance-tagged capsules; every id inside is a
// historical testnet object recorded by the live recorder tee, not hand-typed live wiring.
// Captured wire bytes with provenance are exactly what the decode-tests law wants pinned
// (docs/CODE_LAW.md), so this gate — which exists to stop hardcoded ids in CODE — exempts it.
// The corpus is append-only (new captures add new files), so it is excluded by path prefix, the
// same way docs/ is excluded below, instead of registering every future capsule individually.
const captured_replay_prefix = 'packages/fight/test/fixtures/capsules/'

// Exact CLI-owned files only. A new generated output must be deliberately registered here; there is no broad
// out/** escape hatch. release.json is stamp_all's sole config output; seed files remain run receipts.
// packages/sdk/test/fixtures/*_signature.json entries below are CAPTURED deployed Move signatures
// (packages/sdk/scripts/capture_move_signature.mjs reads each package id off release.json, except immutable 0x1/0x2
// protocol packages, and writes each exact file). This is the same captured-with-provenance exemption as the replay
// capsules: the fixtures exist precisely so every SDK write door is asserted against chain truth instead of its own
// opinion. Keep the allowlist exact-path; a newly composed door must be deliberately added to the capture census.
const generated_files = new Set(
  `packages/frontend/public/release_manifest.json
packages/frontend/src/rpc/fixtures/characters.json
packages/frontend/src/rpc/fixtures/config.json
packages/frontend/src/rpc/fixtures/dungeon_runs.json
packages/frontend/src/rpc/fixtures/encyclopedia.json
packages/frontend/src/rpc/fixtures/fight_results.json
packages/frontend/src/rpc/fixtures/fights.json
packages/frontend/src/rpc/fixtures/kolizeum.json
packages/frontend/src/rpc/fixtures/listings.json
packages/frontend/src/rpc/fixtures/names.json
packages/frontend/src/rpc/fixtures/owner_items.json
packages/frontend/src/rpc/fixtures/pending_outcomes.json
packages/frontend/src/rpc/fixtures/pet_claims.json
packages/frontend/src/rpc/fixtures/pools.json
packages/frontend/src/rpc/fixtures/rare_links.json
packages/frontend/src/rpc/fixtures/sales_history.json
packages/frontend/src/rpc/fixtures/shop.json
packages/frontend/src/rpc/fixtures/sponsor_remaining.json
packages/frontend/src/rpc/fixtures/status.json
packages/frontend/src/rpc/fixtures/taux.json
packages/frontend/src/rpc/fixtures/zone_single.json
packages/frontend/src/rpc/fixtures/zones.json
packages/move/Published.toml
packages/move/aresrpg/Published.toml
packages/move/dungeon/Published.toml
packages/move/engine/Published.toml
packages/move/forgemagie/Published.toml
packages/move/foundation/Published.toml
packages/move/gifting/Published.toml
packages/move/kolizeum/Published.toml
packages/move/scripts/out/ceremony_manifest.json
packages/move/scripts/out/seed_manifest.json
packages/move/social/Published.toml
packages/move/spells/Published.toml
packages/sdk/src/deployment/release.json
packages/sdk/test/fixtures/airdrop_admin_add_addresses_signature.json
packages/sdk/test/fixtures/airdrop_admin_close_signature.json
packages/sdk/test/fixtures/airdrop_admin_create_signature.json
packages/sdk/test/fixtures/airdrop_admin_remove_addresses_signature.json
packages/sdk/test/fixtures/airdrop_claim_signature.json
packages/sdk/test/fixtures/character_extract_delete_character_signature.json
packages/sdk/test/fixtures/character_listing_rule_prove_level_signature.json
packages/sdk/test/fixtures/character_lock_in_kiosk_signature.json
packages/sdk/test/fixtures/character_new_customization_signature.json
packages/sdk/test/fixtures/commission_accept_signature.json
packages/sdk/test/fixtures/commission_cancel_signature.json
packages/sdk/test/fixtures/commission_execute_signature.json
packages/sdk/test/fixtures/commission_redeem_craft_xp_signature.json
packages/sdk/test/fixtures/commission_request_signature.json
packages/sdk/test/fixtures/consume_use_many_signature.json
packages/sdk/test/fixtures/creation_create_character_free_signature.json
packages/sdk/test/fixtures/creation_create_character_paid_signature.json
packages/sdk/test/fixtures/crafting_craft_signature.json
packages/sdk/test/fixtures/dungeon_abandon_signature.json
packages/sdk/test/fixtures/equipment_equip_signature.json
packages/sdk/test/fixtures/equipment_unequip_signature.json
packages/sdk/test/fixtures/extract_burn_signature.json
packages/sdk/test/fixtures/extract_extract_for_burn_signature.json
packages/sdk/test/fixtures/extract_extract_for_equip_signature.json
packages/sdk/test/fixtures/extract_merge_locked_stacks_and_relock_signature.json
packages/sdk/test/fixtures/extract_split_locked_stack_signature.json
packages/sdk/test/fixtures/friends_add_friend_signature.json
packages/sdk/test/fixtures/friends_create_friend_list_signature.json
packages/sdk/test/fixtures/friends_remove_friend_signature.json
packages/sdk/test/fixtures/gathering_gather_signature.json
packages/sdk/test/fixtures/gift_claim_signature.json
packages/sdk/test/fixtures/gift_recall_signature.json
packages/sdk/test/fixtures/gift_send_signature.json
packages/sdk/test/fixtures/header_aresrpg_signature.json
packages/sdk/test/fixtures/item_lock_in_kiosk_signature.json
packages/sdk/test/fixtures/item_prove_listing_amount_signature.json
packages/sdk/test/fixtures/item_prove_lot_signature.json
packages/sdk/test/fixtures/kiosk_borrow_val_signature.json
packages/sdk/test/fixtures/kiosk_delist_signature.json
packages/sdk/test/fixtures/kiosk_list_signature.json
packages/sdk/test/fixtures/kiosk_lock_rule_prove_signature.json
packages/sdk/test/fixtures/kiosk_return_val_signature.json
packages/sdk/test/fixtures/kolizeum_cancel_signature.json
packages/sdk/test/fixtures/kolizeum_create_friends_only_signature.json
packages/sdk/test/fixtures/kolizeum_create_public_signature.json
packages/sdk/test/fixtures/kolizeum_exit_signature.json
packages/sdk/test/fixtures/kolizeum_join_signature.json
packages/sdk/test/fixtures/kolizeum_sweep_signature.json
packages/sdk/test/fixtures/loot_box_claim_pet_signature.json
packages/sdk/test/fixtures/loot_box_open_box_signature.json
packages/sdk/test/fixtures/mob_template_burn_mob_template_signature.json
packages/sdk/test/fixtures/personal_kiosk_borrow_val_signature.json
packages/sdk/test/fixtures/personal_kiosk_return_val_signature.json
packages/sdk/test/fixtures/personal_kiosk_rule_prove_signature.json
packages/sdk/test/fixtures/royalty_rule_fee_amount_signature.json
packages/sdk/test/fixtures/royalty_rule_pay_signature.json
packages/sdk/test/fixtures/shop_burn_sale_signature.json
packages/sdk/test/fixtures/shop_buy_many_signature.json
packages/sdk/test/fixtures/shop_buy_signature.json
packages/sdk/test/fixtures/transfer_policy_confirm_request_signature.json
packages/sdk/test/fixtures/vector_push_back_signature.json
packages/sdk/test/fixtures/vector_singleton_signature.json
packages/sdk/test/fixtures/zones_join_world_signature.json
packages/sdk/test/fixtures/zones_search_zone_signature.json`
    .trim()
    .split('\n')
)
const stamp_all_files = new Set(['packages/sdk/src/deployment/release.json'])

function parse_baseline(text) {
  const baseline = {}
  for (const row of text.trim().split('\n').filter(Boolean)) {
    const [file, encoded = ''] = row.split('\t')
    baseline[file] = Object.fromEntries(
      encoded.split(' ').map((entry) => {
        const split_at = entry.lastIndexOf('=')
        return [entry.slice(0, split_at), Number(entry.slice(split_at + 1))]
      })
    )
  }
  return baseline
}

// Known debt is an exact path + 132-bit ID fingerprint + occurrence-count multiset. It contains no live IDs.
// Removing an occurrence is allowed; changing an ID, adding a copy, or moving it to another file is not.
// Re-derived 2026-07-21 by running this gate's own scan against the public checkout (never copied from the
// private monorepo's baseline) — every row below is test-fixture mock addresses this tree actually carries.
// packages/frontend/src/game/worn_render_path.test.js: worn_render_path repin — retired
// capuche_bara_vitality's stable id, manifest no longer carries it (ceremony #3).
// packages/frontend/src/world-shell/equip_actions.test.js (#702): emerald_id/amethyst_id repinned to
// cape_kamui/cape_fuwa_black — the prior pair predated ceremony #3 and no longer resolves as living.
// packages/rpc/indexer/src/handlers/ares/snapshot.rs (#1409): FRESH_ARESRPG_ORIGIN repinned from
// ceremony #3's origin to the one release.json currently stamps — one row, same count, still one id.
// packages/rpc/indexer/src/handlers/ares/{journal_tests,tests}.rs (#1579): captured TurnStarted wire
// payload — tx 4KTjXhW15G2GYVXSxcPX2GtqhzxpvLAULtiZo3HgfBz4, checkpoint 365484088; pinned per the
// captured-bytes decode law.
// packages/rpc/indexer/src/handlers/ares/snapshot_tests.rs (#1586): ceremony #4's captured testnet
// release stamp (`release.json` aresrpg origin); its exact lineage selects the 33-byte Effect layout.
const known_rogue_fingerprints = parse_baseline(
  `
packages/fight/src/predict_cast.js	P84p9M8_YyJmgWfE4dDG3s=1
packages/fight/test/trace_512_replay.test.js	Z0vfTLQXOu4aq8cMiSjZCN=1
packages/frontend/e2e/world_fight_mount.spec.ts	2NDG4rOJJAx4-Rluwsehjx=1
packages/frontend/e2e/world_fight_resume_proof.spec.ts	2NDG4rOJJAx4-Rluwsehjx=1 VKzKwy1nbcvFIFF90ntz1c=1 dRSuCQ_gLML4aMW4o5lgQR=1
packages/frontend/src/auth/zklogin_seed.test.ts	QUz2BEa7mrntwOARix5b_p=1
packages/frontend/src/chain/character_lineage.test.ts	FblIUfkP03pv2J7ASVYCOP=1
packages/frontend/src/chain/live_reads.test.js	wYQAXkBBJ6CKZwZs_6j_Dp=1
packages/frontend/src/chain/read_listings.test.js	AiEB9VTbUHS5ej62oRokDb=1 k3I6Lc73q-sXIlrfEqll_e=1
packages/frontend/src/components/address_name.test.tsx	GnCi_YSHRtk364RmiB3uS7=1 _ZtmM1-cuiRTiJDyu6ytq9=1 iZarqbFPgKMesqIlxRIE-_=1
packages/frontend/src/components/item_hover_tooltip.test.tsx	k3I6Lc73q-sXIlrfEqll_e=1
packages/frontend/src/components/mob_detail_view.test.tsx	jNJbhYGdi_9eIR-LsQK4f-=2
packages/frontend/src/follow.test.ts	W3gkgkQLEmIYAZG6AKX-fZ=1 WEE_pEq7li8vQT0s30r6cu=1 iMwjou50-uW1rnuFvnePqx=1 GZ8FuANmDaPCtmX6Omqoae=1 Gti0d0gHjcZTYeADTqdOXZ=1 2GTW6DswsZ2y3Jdo22OJQG=1 FbfRDfS5uTnYufPduZOO05=1 5ZNZs73Bn99BNt8jyHZ0HA=1 qrzyi9mGQ37Z1-r0gBc-7B=1 P7l0Rql7nYcVnmWeDD4ERK=1 Gv0HD-Qa7SkZuV1toJRyB4=1 cUF8Zunifm2_xytoj49u8Y=1 1at3RtUXiEeXmCORTOp5rT=1 HqXKU6gkORD4l9feSHIFxG=1 Li0QJwTcKkE5_Vnu0PMs3d=1 TZqs0ASxOYulcWeHykbNdz=1 2zS6unjM6IscdKWqLP7_Gj=1 LUfd4DeEk79zfoMzsSqmfS=1 0jHv29Z5Z33D_XqkKZzIeP=1 i09St9iLaY18OcwM7u0dcD=1
packages/frontend/src/game/core/abort_copy.test.js	au005r3f9eHYcrXX1WmKe3=1
packages/frontend/src/game/cosmetic_icons.test.js	k3I6Lc73q-sXIlrfEqll_e=1
packages/frontend/src/game/screens/hud/equipment-drag-render.test.jsx	k3I6Lc73q-sXIlrfEqll_e=1
packages/frontend/src/game/worn_render_path.test.js	POpkB6Z7QwedxOoFayWY-D=1 b16OI16aOci7oriuENId-r=1
packages/frontend/src/pages/encyclopedia/recipes.test.ts	3Hl0yoqwBSiOH9myknmaJo=2 O4rUo_ZptFE_7iZqB9Hu4B=1 XabwXqAfLUIMmxRqwNz2xj=1 ZXTYppw8UYTuvWcz-l_aBo=1
packages/frontend/src/world-shell/equip_actions.test.js	l8sL2o7urtAf40JFeWysVx=1 Y3wZ61S6zw6V2qe_fBgR7N=1 hAc9Ks9Z7oNCEsDzX2nU_i=1
packages/frontend/src/world-shell/pending_outcomes.test.js	N5aFzifDFbJx31Hkto3BCF=1 VQQqSbFb9D_xPE9jAm5yOp=1 XtSGlQVulX97xUrdkTGuAe=1 ekgxD8TdUMvdkff1DobEfj=1
packages/move/Move.toml	7zQ9MEWAI2Yn_7h_zoZr3-=1 dvy6XX6oy7UlkvdwIKEBsX=1
packages/move/aresrpg/Move.toml	gfRzOLD-_cQDZ7FzpF66U1=1
packages/move/gifting/tests/creation_tests.move	7hMiZlw1g89bMb7M6s_Vnw=1
packages/move/scripts/apply_shop_payload.mjs	NTiYnCcM5_x1Ea1shtRLDz=1 T-tpGcboIIMyQw9yz9Ku8I=1 yYsD62o35GA6lPkGFHEQxM=1
packages/move/scripts/box_reauthor.mjs	EzyjpUCH-d2rLvqPnYAFtJ=1 TabMnrpY46_N-sHa2nqXkl=1 aZu-fgQ6iuFZS31DDFahLX=1
packages/move/scripts/ceremony_lib.test.mjs	-7duz9K8wOn6BSKD5iaozc=1 YV8eR_K2CN9yluPWLk7Ev2=1 bGM0-Vr30RSoAzF5vNt8uh=2 h1nOGR1FdV0cENii-3ra5z=1 tnjviMSoV9hd45sR0QDz_T=1
packages/move/scripts/fixtures/live_shop_sales.json	-npk9OrWkotUSHN11WhD0H=1 0JQUHm0LS63pwRz_BS1qdp=1 0zcKZ-G7-sZUijV2Q8ooWt=1 1Xw6661l7kl2c6VRpnwjtn=1 21uFzLR0d1CdTY0c8jiSpC=1 2JKJgGwr4gkJm0DYUYZa78=1 2n8VxXfunRe5vH1rjD01Ht=1 2sourvIcb4icyCxevVkTNx=1 3izD25PqRhzjEAKSuzkOss=1 40r5xFyGeaBi4cK5gQtBD-=1 4K2K5hKVPLiaDQcZz4nkQH=1 4nI3NLmTYgUVdMuchIb50z=1 590rrWgxXGoAeAGCBvzd94=1 5QHAjdxtp_BYUqT1UZeREs=1 6YHTD3Nm1UFaR6PTsloRWT=1 6gzekJKz6WZoUQroapm1Ll=1 8Y237ABOBafzxMaH6I-xRN=1 8kfI7aCEtw5_k5lfuhl9yC=1 9I3PfERbnOodmPKb4z_fBV=1 9XLi6ZwLIUDA_TBbsidntL=1 9jZOjVesEpO-z0JVx293Ps=1 CnC7GxyZn_PZHZb1iBJPi8=1 DRjUtrm7ml7HWcdu4yU59l=1 DaJlC7Me_litVpmcKm9qKL=1 ET-YnUn-rFUDU6KSwSiX-_=1 GXny0LHJy6REwtGuIpTabY=1 H37W3yjtmcGwXh4BexgqG3=1 H_KIWTjMDogfZqTCq7Ptgl=1 J1_5ZvadxywvWLg4kBOhim=1 J8hEOcNBm5eGuiJFw6Lt4V=1 JGacMOFTp2WGL9mtEPg3hf=1 Li7GmzJ_jBrqgmsOYM-hD7=1 MNkBFvxE-MCmepZ8NBwVdn=1 MvDiHrosGSbC5idHvMWHTo=1 POpkB6Z7QwedxOoFayWY-D=1 Q7XhwmXDtw-RQOGz1tx9-Q=1 QHvzsm-Sb7R9a2f6RPbV2y=1 QZXDryFS8hzlI-1ngMFNnJ=1 Qd9JHF_GkT_U9epVEXpXvQ=1 RE4WpUM5mQ1byDpUryoZ-r=1 S4VXax0wzTbhpCfEJtSQkc=1 SolDwbl-V4zUDq4dbU7dxx=1 UesVJpmzTCwn45PYpzsVJG=1 WFN_mZdl9Dpff7yMeTvd94=1 WquFklLCQihSXFdmwdj2hp=1 YbaBegPloEMxc66NnuhhFN=1 Z25LyBtF2cddnIGAcJB3oT=1 ZrVbk1bZ7q4UQj2sGK_ZwE=1 _hU7zEHPFwE9DnDOwzL0li=1 b16OI16aOci7oriuENId-r=1 da9zudQRc-6u_9ALEw2JoF=1 eHbVrcaDhvPQrsPsd73I1V=1 gOPuX6f9WpSN_8dxqufM6C=1 h_UQ9Qn2cZgUxFsafZLbTX=1 iTrJQ47Sqt9IRRPj3Rh4G4=1 imXu57iDC4wWQPB3AsK7fe=1 jfjS_C6jp0mQomAcjMDHNB=1 k3I6Lc73q-sXIlrfEqll_e=1 ljWWC2LPYzXMGe-oVLHBPn=1 mPslhJTwjwbRtynr3LEvFh=1 nczypcG9DHYoS1pmYTCRxM=1 q616nDYp1bgov6-RgnfmYt=1 qM_JBvV7a5gHR_l-ACbBL7=1 r3WvSfIb80LypNhhAlAXxc=1 rZCLXJUgAhq9iZqGZ1lflD=1 ueUwo7TM_GPKd7Ey7LTJCv=1 vMq0nloiTFYXUOnh83pY7q=1 vlIPigJ4_D7n3j_Nop78w6=1 w-cdw70a1G_c3FDc8SpTbx=1 xBJPBhnJmG_3hKEY7bXwH-=1 xhTfuPya3mehe8gdbM3qZw=1 z-XpEeNhb2GuDHuB8ml3Mn=1 zIn7Lp_TdQ6xz6uS7s-5ir=1 zwl5e4aHvsHFxuBxwBDdO8=1
packages/move/scripts/item_display_census.test.mjs	DRjUtrm7ml7HWcdu4yU59l=1 xp3J_lEcsNIH_JXcCNKPTQ=1
packages/move/scripts/mint_char.mjs	S6IvCctWbo5qa9s8EYt_ig=1
packages/rpc/api/sponsor_remaining.test.js	x0P3VJgr-zijcOsoq-qooN=1
packages/rpc/api/suins.test.js	GnCi_YSHRtk364RmiB3uS7=1 _ZtmM1-cuiRTiJDyu6ytq9=1 iZarqbFPgKMesqIlxRIE-_=1
packages/rpc/api/views.test.js	11DYtXNi6vTJfeXFq5KIk_=1 1MFpfNqaLZKNEAPXlHLEs1=1 2QtVHAhbS97sGLUdG-NzMM=1 5rAVXfgxLpVgMwL1W6cY_K=1 8TFARfI056Q7e4Gf-H6W5r=1 8tBmEjVb_rsP7oB9XHPfBR=1 9bB1hwnjpZcszG18skbfkS=1 BY0cWLkxdkzjtJJAfRyvKm=1 CKosPzjS4tJfckxFRngTzY=1 D2GayvlKx_9m7UZYmciiPY=1 DOCh7UoT0Q32X_SOqmQ1XS=1 E6_6Elpv-jZSLJepmG5jJ3=1 E8djiixEjlqylhmkrj-ARO=1 FNDGp65Tr5XTB5wCKWGUJf=1 H-W7kfzzHBRq_FpQS2TT99=1 JGQ5nEiBf8Ak9vTOw1wL6y=1 JhXLU8rI2MprJM2GdWt-yq=1 L0a0KcAwEOyLoaSdz0Q980=1 Mag-HySEn87k4_0gvmYyya=1 N6xMzEIZNF9azR6Qcd5634=1 Q5AFDzqBqZt2s99mOooiVP=2 QWmd-Xf5WYJJTHZkRGVJZJ=1 RvaiulURbaW8ZZ5NckjiFr=2 SDoiUT1-7eAmucS9QyNDw5=1 SNwLmY_JLyY51FstZbZYY5=1 T3HMKKaUsleFJu80-_p9YF=1 TcDCTfoHKebe7-2K9w2Jxr=1 UQuqleHaQxt02QbgHWYYXa=1 WBKIklXSelMVp2qJU7eEzi=1 XbjigCQlkbih_7fUKwkXyh=1 XfMhBoKL6AjoOt7T4Fz_T7=1 _ZtmM1-cuiRTiJDyu6ytq9=1 afSvl4kP7EjRKlXoFwHW0P=1 be-zKRn5qrpRhmDeWcI5o3=1 bqDkA79MmHTkWdrMNZg_-3=1 c5mYw-2B9S4_xFdDoQ6izE=1 eD8W7DP5Sp3jnegi_C9xnQ=1 eXQRBWgxgaqRKJGZv5UzXZ=1 fY3hkeqZitTpUjthyUWKU1=1 ft_K2hcJybGZrfMX1YOrEU=1 gqJ2hoLtskRD09_C0waAVp=1 gw-pOZ2k9E2OpqTvRyz_th=1 hiVTxPF5l4dJZs1UPUuEtJ=1 jOh2toZeIsme-GmoHZtG3z=1 jnVlVWxyA-lrZE2v04BItt=1 kXkokI1asY2mu1w9zsEh4Y=1 kmQ4RtR7JQAUQPUSYShDR-=1 lqAQ9gHvhVOjnE57FwLiXI=2 mzmCCHvifFl6eqRqZLrle-=1 o7Rx2nT358zoTM9kSSaOBM=1 p79gCuMwhxlaDYx_EALjcV=1 sFRcZlpDsNE7KsC9IDc4Cj=1 uUVCrMZSR8-fW15KtCRc2U=1 utN1cUBRXy7_GBgs5iooMI=1 v-e7XS4hDkRN6uuOQ35Vz1=1 vDBO0GNj6kRVgCgRcG98kt=1 vOCsRzHaTjeCVsoJSKM-t5=1 vkwN8LG0cBCcy4viUmloCK=1 x0P3VJgr-zijcOsoq-qooN=1 xnjzNKrKigOjTatEa1AUm0=1 zJIoaDPH3-R-l43680Ak4M=1
packages/rpc/indexer/src/handlers/ares/journal_tests.rs	n_nP9nIetjvAIsfGZjqpK_=1 vLyaqotN5JRtlrVQrL_v2X=1 2uoYkK9zp1FbzP5MTEBYsC=1 isup8EJ5fXzfhDSgP_HADa=1
packages/rpc/indexer/src/handlers/ares/snapshot.rs	GnCi_YSHRtk364RmiB3uS7=1 ka-AyBkYeKU3wwjk6eiZvF=1
packages/rpc/indexer/src/handlers/ares/snapshot_tests.rs	-Zeni5xH4lI3MKkLFZwbE6=1 22EHyvk1mVY92oiDgFbup1=1 2NDG4rOJJAx4-Rluwsehjx=2 3Hl0yoqwBSiOH9myknmaJo=1 5ixJ9DPpuiNhxs3wX8Kbdm=1 6dJ7XI8rgc0lyFd5ukOxxF=1 7P7C_0HJtJ0rQbYwCt0IPV=2 7k0kA75W7fpMMQ90KXw21u=1 ANJW5n_uw5hwCRu-yyATt7=1 D54xCFOZHfJDKCWebJf7n8=1 E9cA3BsyVmPwpn1CTRz92Y=1 H-W7kfzzHBRq_FpQS2TT99=1 N5aFzifDFbJx31Hkto3BCF=3 O4rUo_ZptFE_7iZqB9Hu4B=1 QFQdCX3oFGedcTh3UnBDD9=1 R2DIHapKJf5K-SZiLv_Z0y=1 TcDCTfoHKebe7-2K9w2Jxr=2 VQQqSbFb9D_xPE9jAm5yOp=1 WBKIklXSelMVp2qJU7eEzi=2 XabwXqAfLUIMmxRqwNz2xj=1 XiZ2Q5GgSQy-6a0t_NdCHM=2 XrPeVowHgTOvZGqB1CHV-k=1 XtSGlQVulX97xUrdkTGuAe=1 XvPdsAHZBbhL9Si9XVfjLC=1 ZXTYppw8UYTuvWcz-l_aBo=1 _ZtmM1-cuiRTiJDyu6ytq9=4 avkdLmAEoj_TX3ejlyoH1J=1 ekgxD8TdUMvdkff1DobEfj=1 ka-AyBkYeKU3wwjk6eiZvF=1 mqXRYuioas071dstXw-UGp=1 rYvntAU7EjfU85mWIs7EvS=4 sBDRD6WJsIl74vHiZfzyDU=1 utN1cUBRXy7_GBgs5iooMI=1 vymORMb8mZn3UJOa5cggMv=1 w0WApkLrugVfd6ZUjWf89E=1 zv2gvnYoeHjsQtZ-lWPmvx=1
packages/rpc/indexer/src/handlers/ares/tests.rs	MEFNovPXkvBrVXsgAup0s7=1 isup8EJ5fXzfhDSgP_HADa=1
packages/sdk/test/character.test.js	1d4CwgRM0ri-mhm1TRYmOs=1 5ACRYmPkTcJ4S19jtDTUna=1 J5FcARcg_FSS-rBwFyFS6F=1 ZEI2XU8OM1J9HbuWmvyLWW=1 _IwbWbOU7kAU7djD5tz9lD=1 eAEVBe4bWVKc0tUrp61Taz=1 mEEFZGlPdYqTUP9adWJN4m=1 mGViIkohWJeB36IytW2g4s=1
packages/sdk/test/dungeon.test.js	xmnoLwzYYeN5pZPyMiBhuf=1
packages/sdk/test/fight_random_pin.test.js	xmnoLwzYYeN5pZPyMiBhuf=1
packages/sdk/test/items.test.js	15bLdZq0-9Kdvno1LjjHbR=1 3HBIa6Y-URHz5AH2yDgUB0=1 _IwbWbOU7kAU7djD5tz9lD=1 eAEVBe4bWVKc0tUrp61Taz=1
packages/sdk/test/random_pin_remaining.test.js	xmnoLwzYYeN5pZPyMiBhuf=1
packages/sdk/test/social_onchain.test.js	rYvntAU7EjfU85mWIs7EvS=1
scripts/check-constraints.sh	A_78KFzXWSZOE2PgWSLTY2=1 WF8K2AgphFGEB8b75jH392=1 ZT18OOD8Jb47K9XVlJQFUx=1 iG6muWKjphwqvpsv-a_oin=1 tKzCXdn5giyE5JtjatNIeb=1
`
)

// Narrow, exact-prefix exclusions — NOT a debt bucket like known_rogue_fingerprints above. Each directory
// here holds CAPTURED wire data (a real chain receipt/trace/tx-outcome payload with recorded provenance),
// never hand-typed. The gate targets hardcoded ids in CODE — a decode-law fixture or a pinned regression
// capsule is evidence, not a live pointer, so it can never drift the way a hardcoded id in logic does. Keep
// each entry exact and commented; this is not a general test/gold/** escape hatch.
const sanctioned_fixture_prefixes = [
  // decode-law fixtures: captured chain receipt/event JSON, byte-for-byte from a real indexed run.
  'test/gold/fixtures/receipts/',
  // issue #512's pinned live fight/store capsule (trace_512_replay.test.js) — the exported wire payload,
  // not a model-generated twin; the filename itself embeds the captured fight's id.
  'packages/fight/test/fixtures/traces/',
  // issue #701's captured trace_format-1 edge fight (parity_committed.test.js) — real recorder-tee wire bytes
  // with provenance, replayed through both fold pipelines; every id is a historical testnet object, not wiring.
  'packages/fight/test/fixtures/parity/',
  // the live zone-composition truth (zone_chain_parity.test.js): every id is a `zones_view` SimulateTransaction
  // reading of the deployed package for zone 487:487 — the world, its package lineage and the mob/resource
  // template ids the CHAIN reports, captured with provenance. Evidence the twin is checked against, never a
  // pointer any code reads. Registered as the exact file, not its directory: the sibling fixtures in that
  // folder are model-derived and must keep facing the gate.
  'packages/sim/test/fixtures/zone_487_chain_truth.json',
  // the Move half of that SAME capture (zone_gen_grid_tests.move): the twin-fixture law puts the identical
  // chain reading on both sides of the derivation, and a Move test cannot read the JSON above — the ids are
  // transcribed from it, with the capture's provenance in the file header. Same evidence, same zone 487:487,
  // same `zones_view` reading; nothing here is a pointer any shipped code follows. Exact file, not a directory.
  'packages/move/foundation/tests/zone_gen_grid_tests.move',
  // issue #1467's captured DROPPED-BY payload (dropped_by.test.ts): the live `/v1/encyclopedia?kind=mobs`
  // rows that drop Wooling Fleece, byte-for-byte from the deployed read API with a provenance header — the
  // evidence that the bundled seed receipt had drifted to ZERO matches. Inverting these rows with the same
  // model that built them would prove nothing; every id is a captured reading, not a pointer code follows.
  // Exact file, not a directory: a future fixture beside it must face the gate on its own provenance.
  'packages/frontend/test/pages/encyclopedia/fixtures/live_wooling_drops.json',
  // issue #1809's AoE splash / target_filter parity row (aoe_splash_target_filter.test.js and the
  // aoe_target_filter_tests.move twin): the one id is Gobadoc the Gourmand's MobTemplate, read from the
  // deployed package on 2026-08-01 with the reading dated in the file's own `_doc` header. It is the
  // provenance of a captured shape, not a pointer any shipped code follows — nothing resolves it at
  // runtime. Exact file, not a directory: the model-derived fixtures beside it keep facing the gate.
  'packages/sim/test/fixtures/aoe_splash_target_filter.json',
]

// Exact file + exact id — the same captured-with-provenance exemption as the prefixes above, at the only
// granularity a MIXED file allows. A file listed above leaves the census entirely; that is safe only for a
// pure capture. `snapshot_tests.rs` is both: dozens of hand-typed synthetic mock ids, already carried as
// debt in the baseline above, PLUS a few whole-object wire captures the decode-tests law requires pinned.
// Registering it as a prefix would delete its baselined rows from the census and blind the whole suite to
// this gate forever — strictly wider than the hole the gate exists to close. Registering the captured ids
// individually leaves every other id in the file, and every future one, facing the census. Ids are keyed by
// the same fingerprint the baseline uses: a gate that scans every tracked file must never hand-type a live
// id into its own source. Add a row here only when the capture's provenance is recorded in the fixture's
// own header, and never a whole file.
const sanctioned_fixture_ids = {
  // packages/rpc/indexer/src/handlers/ares/snapshot_tests.rs — two LIVE-object BCS captures, decoded by the
  // indexer's real model so a chain-side field-order drift fails here instead of silently mis-reading
  // offsets. Every id is an evidence pin inside those captured bytes, never shipped configuration: nothing
  // resolves one at runtime, and re-encoding the wire with this crate's own model would prove nothing.
  //   #1886 — GameConfig 0xbde6…e03d, version 251, prevTx F4WK1D8KB6uLuB2RA9ze6p94Ng4YKso2ZdXypznYLtUy.
  //   #2123 — Creation 0x4b21…88af, version 963105141, prevTx AKv9vGpSGEEt1DnPXZgkUY1hZfYma8JuCvCREUC1dg5U,
  //           plus the `classes` Table id and the creation package address carried in that same capture.
  'packages/rpc/indexer/src/handlers/ares/snapshot_tests.rs': new Set([
    'BvUKCEE72p9XJF7kVZf_Jm', // #1886 GameConfig object id
    'oUytw7-y8w3038METH9GLd', // #2123 Creation object id
    '-Bj9S3eyruLyuUeUU4hOcX', // #2123 creation package address (the captured object's type tag)
    'Ppvwc8pL0TLRJtpopAp2kR', // #2123 the Creation's `classes` Table id, read out of the captured bytes
  ]),
}
const slash_path = (value) => value.split(path.sep).join('/')
const id_fingerprint = (id) => create_hash('sha256').update(id).digest('base64url').slice(0, 22)
const is_sanctioned_fixture_id = ({ file, id }) => sanctioned_fixture_ids[file]?.has(id_fingerprint(id)) === true
const is_scannable_file = (relative_path) =>
  !relative_path.startsWith('docs/') &&
  !relative_path.startsWith(captured_replay_prefix) &&
  path.extname(relative_path) !== '.md' &&
  !sanctioned_fixture_prefixes.some((prefix) => relative_path.startsWith(prefix)) &&
  !relative_path.split('/').some((segment) => ignored_segments.has(segment))

function walk_files(root, directory = root, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored_segments.has(entry.name)) continue
    const absolute_path = path.join(directory, entry.name)
    if (entry.isDirectory()) walk_files(root, absolute_path, files)
    else {
      const relative_path = slash_path(path.relative(root, absolute_path))
      if (is_scannable_file(relative_path)) files.push(relative_path)
    }
  }
  return files
}

function scan_files(root) {
  const listed = spawn_sync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (listed.status !== 0) return walk_files(root).sort()
  return listed.stdout
    .split('\0')
    .filter((file) => file && is_scannable_file(file))
    .sort()
}

function source_hits(relative_path, source) {
  return source.split(/\r?\n/).flatMap((line, index) =>
    [...line.matchAll(id_re)].map((match) => ({
      file: relative_path,
      line: index + 1,
      id: match[0],
    }))
  )
}

function file_hits(root, relative_path) {
  const absolute_path = path.join(root, relative_path)
  if (!fs.existsSync(absolute_path)) return []
  const stat = fs.lstatSync(absolute_path)
  if (!stat.isFile()) return []
  const source_buffer = fs.readFileSync(absolute_path)
  if (source_buffer.includes(0)) return []
  return source_hits(relative_path, source_buffer.toString('utf8')).filter((hit) => !is_sanctioned_fixture_id(hit))
}

function classify_hits(hits, strict) {
  const sanctioned = []
  const baseline = []
  const rogue = []
  const seen = {}
  for (const hit of hits) {
    if (generated_files.has(hit.file)) {
      sanctioned.push(hit)
      continue
    }
    const fingerprint = id_fingerprint(hit.id)
    const key = `${hit.file}\0${fingerprint}`
    seen[key] = (seen[key] ?? 0) + 1
    const allowance = known_rogue_fingerprints[hit.file]?.[fingerprint] ?? 0
    if (!strict && seen[key] <= allowance) baseline.push(hit)
    else rogue.push(hit)
  }
  return { sanctioned, baseline, rogue }
}

function fresh_control_rogue_count() {
  const fresh_id = `0x${'c0'.repeat(32)}`
  const hits = source_hits('scripts/chain-id-fresh-control.js', `const chain_id = '${fresh_id}'`)
  return classify_hits(hits, false).rogue.length
}

function print_hits(label, hits) {
  if (!hits.length) return
  console.log(`${label} (${hits.length}):`)
  const by_file = Object.groupBy(hits, (hit) => hit.file)
  for (const file of Object.keys(by_file).sort())
    console.log(`  ${by_file[file].map((hit) => `${hit.file}:${hit.line}:${hit.id}`).join(' ')}`)
}

function generated_purpose(file) {
  if (stamp_all_files.has(file)) return 'SANCTIONED — stamp_all output'
  if (file.endsWith('Published.toml')) return 'SANCTIONED — Move/ceremony lineage record'
  if (file === 'packages/frontend/public/release_manifest.json') return 'SANCTIONED — release_prepare output'
  if (file === 'packages/move/scripts/out/ceremony_manifest.json')
    return 'SANCTIONED — publish/upgrade ceremony receipt'
  if (file === 'packages/move/scripts/out/seed_manifest.json') return 'SANCTIONED — seed ceremony run receipt'
  return 'SANCTIONED — CLI-generated evidence/receipt'
}

function secret_denylist(root) {
  const constraints = fs.readFileSync(path.join(root, 'scripts/check-constraints.sh'), 'utf8')
  const row = constraints.split(/\r?\n/).find((line) => line.startsWith('LEAKED_ADDR_RE=')) ?? ''
  return new Set(row.match(id_re) ?? [])
}

function generated_inventory_section(hits, denied_ids) {
  const by_file = Object.groupBy(hits, (hit) => hit.file)
  const denied_count = hits.filter((hit) => denied_ids.has(hit.id)).length
  const rows = Object.keys(by_file)
    .sort()
    .map((file) => {
      const occurrences = by_file[file]
        .map((hit) =>
          denied_ids.has(hit.id)
            ? `\`${hit.line}\` → S6 fingerprint \`${id_fingerprint(hit.id)}\``
            : `\`${hit.line}\` → \`${hit.id}\``
        )
        .join('<br>')
      return `- \`${file}\` — ${generated_purpose(file)}: ${occurrences}`
    })
    .join('\n')
  return `## SANCTIONED generated artifact allowlist

The allowlist is exact-path, not \`out/**\`; a new output containing an ID fails until its generator and purpose are reviewed. Every generated occurrence is listed below; the file column plus each \`line → id\` entry is the exact hit location. The ${denied_count} S6-denylist appearances retain their locations but use non-reversible fingerprints so this inventory cannot re-leak a burned address.

${rows}
`
}

function refresh_inventory(root, relative_path, hits) {
  const inventory_path = path.resolve(root, relative_path)
  if (!inventory_path.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('inventory path escapes root')
  const source = fs.readFileSync(inventory_path, 'utf8')
  const section_re = /## SANCTIONED generated artifact allowlist[\s\S]*?(?=\n## ROGUE current occurrences)/
  if (!section_re.test(source)) throw new Error('generated inventory section marker missing')
  const updated = source.replace(section_re, generated_inventory_section(hits, secret_denylist(root)))
  if (updated !== source) fs.writeFileSync(inventory_path, updated)
  console.log(`refreshed sanctioned inventory: ${relative_path} (${hits.length} occurrences)`)
}

function parse_args(args) {
  let root = default_root
  let strict = false
  let inventory = false
  let refresh_inventory_path
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--root' && args[index + 1]) root = path.resolve(args[(index += 1)])
    else if (arg === '--strict') strict = true
    else if (arg === '--inventory') inventory = true
    else if (arg === '--refresh-inventory' && args[index + 1]) refresh_inventory_path = args[(index += 1)]
    else throw new Error(`unknown argument ${arg}`)
  }
  return { root, strict, inventory, refresh_inventory_path }
}

export function run_chain_id_gate({
  root = default_root,
  strict = false,
  inventory = false,
  refresh_inventory_path,
} = {}) {
  const hits = scan_files(root).flatMap((file) => file_hits(root, file))
  const result = classify_hits(hits, strict)
  const baseline_observed = strict ? classify_hits(hits, false).baseline.length : result.baseline.length
  console.log('== AresRPG hardcoded chain-id gate (source/test/config) ==')
  if (refresh_inventory_path) refresh_inventory(root, refresh_inventory_path, result.sanctioned)
  if (inventory) console.log(generated_inventory_section(result.sanctioned, secret_denylist(root)))
  print_hits(strict ? 'ROGUE' : 'WARN BASELINED ROGUE', result.baseline)
  print_hits('ROGUE NEW', result.rogue)
  console.log(
    `chain-id census: total=${hits.length} sanctioned=${result.sanctioned.length} baseline_rogue=${result.baseline.length} new_rogue=${result.rogue.length}`
  )
  const fresh_rogue_count = fresh_control_rogue_count()
  console.log(
    `chain-id control: fresh_synthetic_rogue=${fresh_rogue_count} baseline_observed=${baseline_observed}/${EXPECTED_BASELINE_ROWS}`
  )
  if (fresh_rogue_count !== 1 || baseline_observed !== EXPECTED_BASELINE_ROWS) {
    console.log(
      'CHAIN-ID GATE FAILED. Matcher blind guard lost its one fresh rogue or an observed baseline row; review the matcher and deliberately repin a proven baseline improvement.'
    )
    return 1
  }
  if (result.rogue.length) {
    console.log('CHAIN-ID GATE FAILED. Read IDs from /v1 or an explicitly generated deployment artifact.')
    return 1
  }
  console.log('CHAIN-ID GATE PASSED. No new hardcoded chain IDs.')
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === script_path) {
  try {
    process.exitCode = run_chain_id_gate(parse_args(process.argv.slice(2)))
  } catch (error) {
    console.error(`chain-id gate: ${error.message}`)
    console.error(
      'usage: node scripts/check-chain-ids.mjs [--root PATH] [--strict] [--inventory] [--refresh-inventory FILE]'
    )
    process.exitCode = 2
  }
}
