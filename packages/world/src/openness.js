// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT OPENNESS — the two on-chain openness values a world fight is created with (fight.move
// `public_fight` + `party_id`): PUBLIC = anyone in placement may join, GROUP = only the creator's party.
// ONE home for the constants; the spawns core carries the live choice (openness_set input) and the
// presence core's join-legality rules read the same vocabulary.

export const OPENNESS_PUBLIC = 'public'
export const OPENNESS_GROUP = 'group'
