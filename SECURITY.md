# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.** A public issue is a disclosure —
anyone watching the repository sees it before there's a fix.

Report it privately through GitHub's Security Advisories instead: open the **Security** tab on
this repository and use **"Report a vulnerability"** (or go directly to
[github.com/aresrpg/aresrpg/security/advisories/new](https://github.com/aresrpg/aresrpg/security/advisories/new)).
This opens a private channel with the maintainers — nothing becomes public until a fix ships and
a disclosure date is agreed with you.

## Scope

This repository is the frontend, voxel engine, deterministic combat twin, Sui Move contracts,
SDK, protocol, indexer, realtime server, deployment tooling, and authored content. A report can
concern any executable surface, including:

- A transaction or Move module that lets state change in a way it shouldn't (fund loss,
  unauthorized item/character mutation, bypassing an access check).
- A client-side flaw that leaks a key, forges a signature, or misrepresents chain state as
  authoritative.
- A dependency vulnerability that is actually reachable from this codebase.

Balance disagreements are not security issues. A content-validation or publication flaw that
enables unauthorized state, value, or code execution is in scope.

## What to include

- The affected path (file, module, or endpoint) and, if you have one, a minimal reproduction.
- Impact: what an attacker gains — funds, unauthorized state changes, another player's data.
- For an on-chain finding: the package/module/function involved and, if applicable, the object
  type and a transaction digest.

We'll acknowledge new reports and keep you updated as the investigation progresses.
