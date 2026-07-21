# v1.12.44 — fire, honestly

- The invisible-VFX hunt ends: on machines where the graphics backend silently fell back, the game read depth in the wrong convention and faded every particle to nothing. The backend is now detected truthfully, a broken fade opens to visible instead of invisible, and the ambient system self-heals if its GPU bake fails. Your console also prints one honest line about which backend you actually got.
- Funded wallets sign their own transactions directly — the sponsor is for players who need it, and the fight commit never wedges on the handoff again.
- The encyclopedia now has a watchdog in CI: a logged-in drive that fails the build if item icons or detail data ever go dark again.
- Item stat ranges are now served by the read layer (the encyclopedia's characteristics fill in after the next API deploy).
