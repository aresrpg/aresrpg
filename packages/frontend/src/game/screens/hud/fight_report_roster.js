// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure terminal-card roster adapters. Victory and defeat consume the same recap projection, so neither card
// may grow its own field list and silently drop the mob template identity that powers the bestiary link.

/**
 * @param {Array<{
 *   id: string,
 *   name: string,
 *   team: number,
 *   level: number,
 *   is_player: boolean,
 *   alive: boolean,
 *   template_id?: string | null,
 * }>} roster
 * @param {number} my_team
 * @returns {Array<{
 *   id: string,
 *   name: string,
 *   level: number,
 *   is_player: boolean,
 *   alive: boolean,
 *   hp_pct: number,
 *   template_id: string | null,
 * }>}
 */
export const fight_report_enemy_rows = (roster, my_team) =>
  roster
    .filter((participant) => participant.team !== my_team)
    .map((participant) => ({
      id: participant.id,
      name: participant.name,
      level: participant.level,
      is_player: participant.is_player,
      alive: participant.alive,
      hp_pct: participant.alive ? 100 : 0,
      template_id: participant.template_id ?? null,
    }))
