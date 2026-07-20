# AresRPG Individual Contributor License Agreement (ICLA)

## In plain words (the summary that binds nobody but helps everybody)

- **You keep your copyright.** Your contribution stays yours.
- **You grant Sceat the right to use it commercially, forever** — including selling the game it improves.
- **The game stays his to sell.** Contributing never gives anyone else commercial rights.
- Sign by adding `Signed-off-by:` to your commits after reading the full text below.

**Version 1.0 — 2026**

## Why this exists

`LICENSE` grants the public **noncommercial, no-redistribution** rights only — it
does not let anyone, including the Licensor, sell or commercially exploit the Software. Without this
agreement, a community Contribution would arrive under that same restrictive license and the Licensor
could not lawfully ship it as part of the commercial game. Signing this CLA is what makes a
Contribution _safe to merge_: you keep authorship and copyright; the Licensor gets the broad grant
needed to run AresRPG as a commercial product, including your change. A DCO sign-off alone (below) is
not sufficient by itself — it proves who wrote the code, it does not grant any rights.

## 1. Definitions

- **"You"** means the individual submitting a Contribution to the AresRPG project.
- **"Licensor"** means **Sceat**.
- **"Contribution"** means any original work of authorship — including any modification or addition to
  existing work — that You intentionally submit to the Licensor for inclusion in the Software, by any
  means (pull request, patch, issue attachment, or other channel the project designates), excluding any
  work clearly marked "Not a Contribution."
- **"Software"** has the meaning given in `LICENSE`.

## 2. Grant of Copyright License

Subject to the terms of this agreement, You hereby grant to the Licensor a perpetual, irrevocable,
worldwide, non-exclusive, royalty-free, fully paid-up, sublicensable, and transferable license to
reproduce, prepare derivative works of, publicly display, publicly perform, sublicense, distribute, and
otherwise commercially exploit Your Contribution and derivative works of it, in whole or in part, in any
form, under any license terms the Licensor chooses — including relicensing the Contribution, alone or
combined with other work, under a different license than the one the Software is otherwise distributed
under. **You keep your copyright.** This is a grant of rights alongside your ownership, not an
assignment of it.

## 3. Grant of Patent License

Subject to the terms of this agreement, You hereby grant to the Licensor a perpetual, irrevocable,
worldwide, non-exclusive, royalty-free, sublicensable, and transferable patent license to make, have
made, use, offer to sell, sell, import, and otherwise transfer the Contribution, for any patent claims
you own or control that are necessarily infringed by the Contribution alone or by its combination with
the Software. If any entity institutes patent litigation against the Licensor or any other entity
alleging that the Contribution, or the Software it was incorporated into, constitutes patent
infringement, the patent license granted under this agreement to that entity terminates as of the date
such litigation is filed.

## 4. Your Representations

You represent that:

1. You are legally entitled to grant the licenses above — either the Contribution is your original
   creation, or you have sufficient rights to submit it under these terms.
2. If your employer has rights to intellectual property you create, you have either received permission
   to make the Contribution on behalf of that employer, or your employer has waived such rights, or the
   Contribution falls outside the scope of your employment.
3. Each Contribution you submit is provided as-is, without any warranty of any kind, to the extent
   permitted by applicable law.

## 5. No Obligation

You understand the decision to include a Contribution in the Software is entirely at the Licensor's
discretion, and this agreement does not obligate the Licensor to use, merge, or ship any Contribution.

## 6. Sign-off (DCO-style)

Every commit submitted as a Contribution must carry a `Signed-off-by` trailer:

```
Signed-off-by: Your Name <your.email@example.com>
```

Adding this line certifies the [Developer Certificate of Origin](https://developercertificate.org/): that
you wrote the Contribution or otherwise have the right to submit it under this agreement, and that you
understand it will be kept indefinitely and may be redistributed under the Software's license or any
license the Licensor chooses, per §2 above.

## 7. How signing works (tooling note, not a license term)

CLA capture runs through **cla-assistant-lite** (GitHub Action, no external service, signatures stored
in-repo — no wet-ink signature or third-party account required):

1. On a contributor's first pull request, the bot posts a comment with a link to this agreement and asks
   the contributor to reply exactly: _"I have read the CLA Document and I hereby sign the CLA."_
2. The bot records the signature (GitHub username + timestamp) in a signatures file committed to the
   repository, and sets a required status check on the PR.
3. Every subsequent PR from a signed contributor is auto-verified against that record — no re-signing.
4. An unsigned or declined CLA blocks merge; the PR gate is CLA ✓ alongside lint/tests/build
   (see CONTRIBUTING.md for the full PR workflow).

## 8. General

This agreement is governed by the laws of **France**. It is the entire agreement between You and
the Licensor regarding
Contributions, superseding any prior understanding on the subject.
