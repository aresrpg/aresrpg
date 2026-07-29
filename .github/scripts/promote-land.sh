#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
#
# promote-land.sh — the SHARED landing engine for the promotion queue (issue #105).
#
# ONE home for "land a promote-requested PR onto its base by fast-forward, signatures intact".
# Called by BOTH triggers so the asserts + stamp + ff-push are never duplicated:
#   • .github/workflows/promote.yml       — the owner's `/promote` command (one PR, interactive)
#   • .github/workflows/promote-queue.yml — gate/checks workflow_run:completed (land-on-green)
#
# The green assert itself lives in the sibling promote-green-eval.sh (sourced below, unit-tested
# in test/promote-green-eval.test.sh) — split out so "is this sha actually green" is testable
# against canned `gh api` JSON without a live PR/repo.
#
# Master never takes a merge COMMIT: landing is a fast-forward push of the exact approved head
# SHA, so master's commits stay BYTE-IDENTICAL to edge's (signatures survive perfectly) and the
# pusher is the Actions bot — "reviewer ≠ pusher" holds by construction. The fast-forward assert
# is also the ALWAYS-REBASE tooth: an unrebased branch cannot fast-forward, so the linear law is
# mechanical, not convention.
#
# WHY A QUEUE, WHY NO API REBASE (issue #105 — empirically gated 2026-07-21):
#   GitHub's GraphQL updatePullRequestBranch(updateMethod: REBASE) re-creates commits UNSIGNED
#   (probe verdict: local %G?=N; GitHub REST verification verified=false, reason="unsigned";
#   committer stays the author, no web-flow signing). edge carries a required_signatures rule, so
#   the subsequent fast-forward of an unsigned commit would be REJECTED — the bot therefore NEVER
#   rebases through the API. A stale branch is rebased by its AUTHOR locally (commits stay signed)
#   and lands automatically on its next green cycle; the owner's `/promote` is a one-time REQUEST,
#   not a babysat rebase→wait→re-comment loop.
#
# CONTRACT
#   argv[1] = PR number.   env: GH_TOKEN, GITHUB_REPOSITORY (+ RUNNER_TEMP/GITHUB_OUTPUT if set).
#   Writes `promote_result=<result>` to stdout and, when set, to $GITHUB_OUTPUT (the caller reads
#   it via the step output). Result ∈
#     landed · stale · not-green · wrong-base · unauthorized · not-release-tipped
#   Exit code: 0 landed · 3 transient (stale | not-green — leave the label, the queue retries) ·
#              1 hard refusal (wrong-base | unauthorized | not-release-tipped) or infra error ·
#              4 LANDED, but a post-landing automation dispatch failed — the push is done and must
#                never be retried; the caller reddens its run so a human re-runs the dispatch.
#   MUST run in a repo checked out with `fetch-depth: 0` (needs origin/<base> history for the
#   merge-base ancestor test and the release-subject read).

set -euo pipefail

OWNER_ID=11330271
OWNER_LOGIN=Sceat
LABEL=promote-requested
PR="${1:?PR number required}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}"
# shellcheck source=.github/scripts/promote-land-dispatch.sh
source "$(dirname "${BASH_SOURCE[0]}")/promote-land-dispatch.sh"

# emit <result> — record the outcome for the caller (never let the $GITHUB_OUTPUT write trip
# `set -e`: a plain `&&` returns non-zero when the guard is false and would abort the script).
emit() {
  echo "promote_result=$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "promote_result=$1" >> "$GITHUB_OUTPUT"; fi
}

# ── resolve the base + head (edge | master base only; HEAD_REF reused later for branch cleanup,
#    never re-derived) ─────────────────────────────────────────────────────────────────────────
PR_META=$(gh pr view "$PR" --repo "$REPO" --json baseRefName,headRefName)
BASE=$(jq -r .baseRefName <<<"$PR_META")
HEAD_REF=$(jq -r .headRefName <<<"$PR_META")
case "$BASE" in
  edge | master) ;;
  *) emit wrong-base; echo "PR #$PR targets '$BASE' — the queue serves edge and master only"; exit 1 ;;
esac

# ── owner authorization — the LABEL IS NOT A CAPABILITY ──────────────────────────────────────
# `promote-requested` is add-able by any write collaborator via the UI, so it can never be the
# authorization token. The owner's WORD is: an owner-authored `/promote` comment must exist on
# this PR. This re-establishes "the owner asked for it" in the workflow_run path (which has no
# commenter) and makes a manually-labeled PR un-landable. Numeric id is immortal, login the
# readable second factor — BOTH hold.
OWNER_PROMOTE=$(gh api "repos/${REPO}/issues/${PR}/comments" --paginate \
  --jq "[.[] | select(.user.id==${OWNER_ID} and .user.login==\"${OWNER_LOGIN}\" and (.body|startswith(\"/promote\")))] | length")
if [ "$OWNER_PROMOTE" -lt 1 ]; then
  emit unauthorized; echo "no owner-authored /promote comment on PR #$PR — refusing"; exit 1
fi

# Approval story (unchanged): owner-authored PRs — the /promote comment IS the owner's approval
# act (GitHub forbids self-review, so a review assert would be unsatisfiable by construction);
# foreign-authored PRs — the owner's APPROVED review is required ON TOP of his /promote. Pin the
# author by numeric id (immortal) with login as the second factor; read the REST numeric id.
AUTHOR_ID=$(gh api "repos/${REPO}/pulls/${PR}" --jq '.user.id')
AUTHOR_LOGIN=$(gh api "repos/${REPO}/pulls/${PR}" --jq '.user.login')
if [ "$AUTHOR_ID" = "$OWNER_ID" ] && [ "$AUTHOR_LOGIN" = "$OWNER_LOGIN" ]; then
  echo "owner-authored PR — the /promote comment is the owner's approval act"
else
  APPROVED=$(gh api "repos/${REPO}/pulls/${PR}/reviews" \
    --jq "[.[] | select(.user.login==\"${OWNER_LOGIN}\")] | last | .state")
  if [ "$APPROVED" != "APPROVED" ]; then
    emit unauthorized; echo "foreign-authored PR #$PR without a standing owner review — refusing"; exit 1
  fi
fi

# ── fetch the exact head + a FRESH base (race-safe: a prior land this run may have moved it) ──
# refs/pull/<n>/head is GitHub-maintained for every open PR (works for fork PRs too), so it is
# the robust source of the head to land — and ties the green check, the ff assert and the push
# to ONE sha. Always refresh origin/<base>; refresh origin/edge too when landing to master.
FETCH_REFS=("refs/pull/${PR}/head:refs/promote/land-${PR}" "+refs/heads/${BASE}:refs/remotes/origin/${BASE}")
if [ "$BASE" != edge ]; then FETCH_REFS+=("+refs/heads/edge:refs/remotes/origin/edge"); fi
git fetch --quiet origin "${FETCH_REFS[@]}"
HEAD_SHA=$(git rev-parse "refs/promote/land-${PR}")
# edge as it stands BEFORE any push below — the base of the range the landing automations sweep.
# Both fetch shapes above refresh origin/edge, and it is read HERE because `git push` updates the
# remote-tracking ref, which would erase the before-state the sweep needs.
EDGE_BEFORE=$(git rev-parse refs/remotes/origin/edge)

# ── master-hop: the tip must be release-shaped (release-only-production law) ─────────────────
if [ "$BASE" = master ]; then
  SUBJECT=$(git log -1 --pretty=%s "$HEAD_SHA")
  case "$SUBJECT" in
    "release: v"*) echo "release-tipped ($SUBJECT) — proceeding" ;;
    *) emit not-release-tipped; echo "master landings carry a release-prep tip; land the version bump + changelog on edge first"; exit 1 ;;
  esac
fi

# ── fast-forward gate (the always-rebase tooth) — BEFORE the green check ─────────────────────
# If the base is not an ancestor of the head, the branch is stale. In this signature-preserving
# queue the AUTHOR rebases locally (never the API — rebased copies come back unsigned); report
# `stale` so /promote can post the one-line rebase command, and leave the label so the next green
# cycle lands it with zero further interaction.
if ! git merge-base --is-ancestor "refs/remotes/origin/${BASE}" "$HEAD_SHA"; then
  emit stale; echo "PR #$PR is behind $BASE — author-side rebase required"; exit 3
fi

# ── checks green? — every REQUIRED check-run present + green on this exact sha (issue #695) ──
# The old assert only rejected check-runs that EXISTED and were non-green — a required check that
# hadn't been CREATED yet at evaluation time (promote-queue.yml fires on EITHER gate or checks
# completing; a slow checks.yml leg like `smoke`, Playwright + live network, can still be
# unregistered on the sha when the faster gate.yml run fires the queue first) was invisible to it
# and read as clean — a still-red landing could fast-forward. evaluate_green() (sourced from
# promote-green-eval.sh, unit-tested in test/promote-green-eval.test.sh) additionally requires
# every name in REQUIRED_CHECKS to have a completed green check-run on $HEAD_SHA — missing/pending
# = not eligible, and an empty check-runs response fails closed the same way.
# shellcheck source=.github/scripts/promote-green-eval.sh
source "$(dirname "${BASH_SOURCE[0]}")/promote-green-eval.sh"
# PROVENANCE (#1305 review): name-matching alone let green rows from another context satisfy a
# master promotion. The engine now tells evaluate_green which PR and head ref a row must belong to.
PROVENANCE_JSON=$(jq -nc --argjson pr "$PR" --arg head "$HEAD_REF" '{pr: $pr, head_ref: $head, app: "github-actions"}')
CHECK_RUNS_JSON=$(gh api --paginate "repos/${REPO}/commits/${HEAD_SHA}/check-runs" --jq '.check_runs[]' | jq -s '.')
GREEN=$(evaluate_green "$CHECK_RUNS_JSON" "$REQUIRED_CHECKS_JSON" "$PROVENANCE_JSON")
if [ "$GREEN" != "green" ]; then
  emit not-green; echo "${GREEN#not-green: } on $HEAD_SHA — leaving it queued"; exit 3
fi

# ── the republish window never reaches production (#1305 review) ────────────────────────────
# Asserted HERE, from the tree at the exact SHA about to become master, and not delegated to a
# check-run: the preflight's own master-bound refusal is a check, and a check is only as good as
# the provenance of the row reporting it. This reads the blob and trusts nothing.
if [ "$BASE" = master ]; then
  MARKER_PRESENT=no
  if git cat-file -e "${HEAD_SHA}:packages/move/REPUBLISH_WINDOW" 2>/dev/null; then MARKER_PRESENT=yes; fi
  WINDOW=$(evaluate_republish_window "$BASE" "$MARKER_PRESENT")
  if [ "$WINDOW" != ok ]; then
    emit republish-window; echo "${WINDOW#refused: } — delete the marker at ceremony close, then promote"; exit 1
  fi
fi

# ── stamp the `promoted` status BEFORE the push (master only) — ORDER IS LOAD-BEARING ───────
# GitHub evaluates the required-status-checks ruleset against the statuses already on the SHA AT
# PUSH TIME (statuses attach to the commit object, not a ref). A ff-push writes $HEAD_SHA onto
# master VERBATIM, so once master's ruleset requires `promoted`, that status must already exist
# on the SHA or the push is rejected before any post-push step could run. Stamping here is safe:
# $HEAD_SHA already exists as a commit object (fetched above); a stamped-but-never-pushed SHA is
# harmless — a commit status carries no permission of its own. Only THIS engine can mint it, and
# only after the asserts above pass, which is what makes master bot-exclusive by construction.
if [ "$BASE" = master ]; then
  gh api "repos/${REPO}/statuses/${HEAD_SHA}" -f state=success -f context=promoted \
    -f description="fast-forwarded to master by the promote queue" >/dev/null
fi

# ── the landing: a plain fast-forward push (git itself rejects anything non-ff) ─────────────
# Everything past this line is post-landing bookkeeping over a push that ALREADY HAPPENED and can
# never be retried. A failed landing-automation dispatch is therefore recorded, never fatal here:
# aborting mid-tail would strand the `promote-requested` label, re-land the same PR every CI cycle,
# and make the /promote handler report a completed landing as a refusal. It is answered at the very
# end with exit 4, which reddens the caller's run without lying about what happened.
DISPATCH_FAILED=0
git push origin "$HEAD_SHA:$BASE"
echo "landed PR #$PR onto $BASE ($HEAD_SHA)"
if [ "$BASE" = edge ]; then
  dispatch_edge_landing_automations "$EDGE_BEFORE" "$HEAD_SHA" || DISPATCH_FAILED=1
fi

# ── master-only post-landing tail (best-effort; the promotion already HAPPENED at the push) ──
if [ "$BASE" = master ]; then
  # Align edge to the promoted head so the branches never drift at release points (skip-warn
  # when edge has already moved ahead).
  if git merge-base --is-ancestor "refs/remotes/origin/edge" "$HEAD_SHA"; then
    if git push origin "$HEAD_SHA:edge"; then
      echo "edge aligned to master ($HEAD_SHA)"
      dispatch_edge_landing_automations "$EDGE_BEFORE" "$HEAD_SHA" || DISPATCH_FAILED=1
    else
      echo "WARN: edge align push failed (non-fatal; master already landed)"
    fi
  else
    echo "edge has moved ahead of the promoted head — no align needed"
  fi
  # GITHUB_TOKEN pushes don't trigger push-workflows, so dispatch release.yml explicitly.
  gh workflow run release.yml --ref master || echo "WARN: release.yml dispatch failed — re-run it manually (master already landed)"
  # Keep exactly one edge→master "preparing" draft open so the next release always has a PR to
  # /promote. Idempotent (list guard) and non-blocking: right after the align edge==master has no
  # diff, so gh pr create is a quiet no-op until edge advances.
  OPEN=$(gh pr list --repo "$REPO" --base master --head edge --state open --json number --jq 'length')
  if [ "$OPEN" = "0" ]; then
    git show "${HEAD_SHA}:packages/frontend/package.json" > "${RUNNER_TEMP:-/tmp}/pkg.json"
    NEXT=$(node -e "const v=require('${RUNNER_TEMP:-/tmp}/pkg.json').version.split('.'); console.log(v[0]+'.'+v[1]+'.'+(+v[2]+1))")
    gh pr create --repo "$REPO" --base master --head edge --draft \
      --title "release: v${NEXT} (preparing)" \
      --body "Standing release draft, opened automatically after the previous promotion. Bump packages/frontend/package.json to v${NEXT} and add changelog/NNN-RELEASE-v${NEXT}.md before /promote." \
      || echo "no diff between edge and master yet (or a draft already exists) — non-blocking"
  else
    echo "an edge→master PR is already open — nothing to do"
  fi
fi

# ── delete the landed branch (best-effort; NEVER master or edge) ───────────────────────────
# GitHub's repo-level `delete_branch_on_merge` setting never fires for this flow — landings are
# fast-forward PUSHES (above), not merge-button events, so no auto-delete is ever triggered and
# landed branches pile up (34 as of 2026-07-21). Delete the PR's own head branch explicitly.
# Guarded by NAME, not by BASE: a master landing's head IS `edge` (the release PR) and must
# survive — only feature branches are ever actually removed. A failed delete is logged and
# swallowed: the land already happened, cleanup is best-effort and must never fail the promotion.
if [ "$HEAD_REF" = master ] || [ "$HEAD_REF" = edge ]; then
  echo "head branch is '$HEAD_REF' — never deleted"
else
  gh api -X DELETE "repos/${REPO}/git/refs/heads/${HEAD_REF}" \
    && echo "deleted branch $HEAD_REF (landed PR #$PR)" \
    || echo "WARN: failed to delete branch $HEAD_REF (non-fatal; PR #$PR already landed)"
fi

# ── landed: drop the label (bookkeeping) + report ───────────────────────────────────────────
gh pr edit "$PR" --repo "$REPO" --remove-label "$LABEL" >/dev/null 2>&1 || true
emit landed
if [ "$DISPATCH_FAILED" = 1 ]; then
  echo "::error::PR #$PR landed on $BASE ($HEAD_SHA) but a landing automation dispatch failed — the board sweep did not run; re-run it manually"
  exit 4
fi
exit 0
