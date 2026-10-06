---
name: update-readme
description: Bring README.md back in line with the code. Use whenever work changes src/, tests/, wrangler.jsonc, package.json, the Python reference files or docs/ (new files, routes, messages, rules, commands, limits or architecture), before committing or opening a pull request, when AGENTS.md's README check finds commits since the last sync, or when the user asks to update, refresh or check the README or the architecture docs.
---

# Update the README

`README.md` is the project's main explanation of what the app does and how it's built. It goes stale quietly: a renamed file, a new message type or a changed limit makes it wrong without anyone noticing. This skill finds what changed since the README was last checked, verifies the README's claims against the code, and fixes only what's out of date.

## 1. Find what changed since the last sync

The last line of `README.md` is a marker:

```
<!-- readme-synced-commit: <sha> -->
```

Run:

```sh
git diff --stat <sha> -- src tests wrangler.jsonc package.json '*.py' docs Dockerfile .github
git status --short
```

`git diff <sha>` compares that commit with your working tree, so uncommitted work counts too. If nothing relevant changed, say the README is up to date, leave the marker alone and stop. If the marker is missing or the sha is unknown, review the whole README.

## 2. Read the code, not just the diff

The diff only shows *where* to look. Before editing a section, read the current files it describes, because the README makes concrete claims that have to match exactly:

| README section | Check against |
|---|---|
| Quick start, Testing, Deploying | `package.json` scripts, `wrangler.jsonc`, the test files in `tests/`, `Dockerfile`, `.github/workflows/deploy.yml` |
| How the game plays | `shared/game.js` (wrong-tap limits, clock length), `shared/multiplayer.js` (modes, player limits, stuck-game handling), `MAX_CARDS` and `SUPPORTED_SYMBOLS_PER_CARD` in `shared/generator.js` |
| Architecture (text and mermaid diagram) | `wrangler.jsonc` (assets, `run_worker_first`, Durable Object bindings), `src/server/index.js`, `src/server/room.js` (hibernation, storage, alarm, ping), which modules import `shared/` |
| How the deck is built | `shared/generator.js`, `shared/checker.js`, the emoji count in `shared/symbols.js` |
| Multiplayer protocol | routes in `src/server/index.js`; message types handled in `room.js` (`webSocketMessage`, `stateFor`, events); what `friends.js` sends; the code alphabet and `PING_EVERY_MS` |
| Project layout | the actual file tree (`find src tests -type f`, top-level files) |
| Design decisions and limits | the code paths behind each claim; add new limits you find, remove ones that no longer hold |

Constants in the README (player limits, card cap, wrong-tap numbers, room lifetime, ping interval, code length and alphabet, emoji count) must match the code. Search for each one rather than assuming.

## 3. Edit

- Change only what's wrong or missing. Keep the existing structure, headings and tone, so readers and future runs can find things.
- Describe what the code does now, not what was planned. Never document a feature that doesn't exist yet. If something is half-built, say so.
- New file → add it to Project layout. New route or message → add a row to the protocol tables. New layer or external service → update the mermaid diagram and the numbered list under Architecture.
- Keep the writing plain: short sentences, tables for reference material, no marketing language.
- If you can't verify a claim (for example, current Cloudflare plan limits), soften it or link to the source rather than stating it as fact.

## 4. Record the sync

Replace the marker's sha with the current commit:

```sh
git rev-parse --short HEAD
```

If the README now also reflects uncommitted changes, still record `HEAD`. The next run diffs from there and will re-check that work once it's committed, which is harmless.

## 5. Report

Tell the user in a few lines:

- which sections changed and why
- anything you couldn't verify
- anything in the code that looks inconsistent (for example, the same constant defined differently in two places)

Don't commit unless the user asked you to.
