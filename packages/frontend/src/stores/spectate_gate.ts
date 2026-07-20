import { create } from 'zustand'

// THE interaction gate for the live-world canvas — canvas input is ignored unless the visitor is in spectate
// mode ("watch the live world") or is already logged in. The backdrop behind the
// login card is DISPLAY-ONLY (the cinematic auto-drift keeps playing) until the visitor either logs in OR
// explicitly clicks "watch the live world". This store is the ONE home for the second fact — `chosen`; the
// derived truth is `chosen || logged_in`. auth.tsx flips it (spectate CTA on, sign-in-to-play off);
// GameWorldHost + the spectate camera read it. Reset to false on any account change (a fresh login screen is
// display-only again) — done in GameWorldHost's [address] effect.
interface SpectateGateState {
  chosen: boolean
  set_chosen: (chosen: boolean) => void
}

export const use_spectate_gate = create<SpectateGateState>((set) => ({
  chosen: false,
  set_chosen: (chosen: boolean) => set({ chosen: !!chosen }),
}))
