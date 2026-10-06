# Agent guide

Instructions for AI coding agents working in this repository. Read `README.md` first: it explains what the app does and how it's built.

## Commands

```sh
npm install                                      # once
npm run dev                                      # app + game rooms at http://localhost:8787
npm test                                         # JavaScript tests (node --test)
python3 -m unittest tests/TestDeckGenerator.py   # Python reference tests
npm run deploy                                   # publishes to Cloudflare; ask the user first
```

## Conventions

- **Game rules live only in `src/client/shared/`.** These files must stay free of browser and server code (no `document`, no `cloudflare:workers`). The phones and the `GameRoom` Durable Object both import them, and `tests/js/` tests them directly. Change a rule there, then add or update a test.
- **No build step.** `src/client/` is served exactly as written. Use plain ES modules with relative imports. Add a bundler only if the user asks.
- **Decks use symbol ids, not pictures.** Mapping ids to emoji (or, later, players' photos) happens at display time.
- **Emoji must be everyday objects with no faces, and no two may look alike** (`docs/GameRequirements.md`). Check new ones for look-alikes, such as broccoli next to a tree.
- **Multiplayer is server-authoritative.** Phones send taps; `src/server/room.js` decides. Never send a player another player's cards.
- **Room state must survive hibernation.** In `room.js`, save to storage before relying on in-memory state.
- **Deploying publishes a public URL.** Run `npm run deploy` only when the user asks.
- **The Python files are the reference implementation.** If the deck algorithm changes, keep `DeckGenerator.py` and `src/client/shared/generator.js` in step.

## Keeping the README current

`README.md` must describe the code as it is. It ends with a marker recording the commit it was last checked against:

```
<!-- readme-synced-commit: <sha> -->
```

**When to update it:**

1. **At the end of any task** that changes `src/`, `tests/`, `wrangler.jsonc`, `package.json`, the `*.py` files or `docs/` in a way the README describes: a new file, route, message, rule, command, limit or architectural change.
2. **Before committing or opening a pull request.**
3. **Periodically:** at the start of a session, run the check below. If relevant files changed since the marker, update the README before starting other work, or tell the user it's stale if they'd rather not wait.

```sh
git diff --stat "$(grep -o 'readme-synced-commit: [0-9a-f]*' README.md | cut -d' ' -f2)" -- src tests wrangler.jsonc package.json '*.py' docs
```

**How to update it.** Claude Code agents: use the `update-readme` skill (`.claude/skills/update-readme/SKILL.md`). Other agents follow the same steps:

1. List what changed since the marker (the command above, plus `git status --short` for uncommitted work).
2. For each affected README section, read the current code it describes. Don't rely on the diff alone. Constants such as player limits, card cap, wrong-tap numbers, room lifetime, ping interval and room-code alphabet must match the code exactly.
3. Fix only what's stale or missing, keeping the README's structure and plain tone. Never document features that don't exist yet.
4. Set the marker to `git rev-parse --short HEAD`.
5. Tell the user what changed and anything you couldn't verify.
