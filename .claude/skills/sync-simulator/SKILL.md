---
name: sync-simulator
description: Update the Dobble Plane Tracer (tests/plane_tracer.html) so it simulates exactly what docs/CardGenerationAlgorithm.txt currently says, then republish it to its existing link. Use this whenever the algorithm file has changed since the last sync — including when a hook message says the algorithm is out of sync with the simulator — or when the user asks to sync, update or refresh the simulator, tracer or visualisation, or says the page no longer matches the algorithm or its step numbers. Also use it right after you edit docs/CardGenerationAlgorithm.txt yourself. In the main conversation, prefer starting the simulator-syncer subagent, which follows this skill in the background, so the user isn't kept waiting; do the sync inline only if the user asks for that.
---

# Sync the simulator to the algorithm

`tests/plane_tracer.html` is a test instrument for `docs/CardGenerationAlgorithm.txt`. The user reads a step number on the page and looks it up in the text file, and they use the pair-check panel to find out whether the algorithm *as written* produces a valid deck. So the page is only useful if it is a faithful, literal transcription of the current file: same steps, same numbers, same loop structure, same bugs.

## Workflow

1. **See what changed.** Read `docs/CardGenerationAlgorithm.txt` in full. If `.claude/simulator-sync/algorithm.txt` exists, diff against it (`diff -u .claude/simulator-sync/algorithm.txt docs/CardGenerationAlgorithm.txt`); that snapshot is what the page currently simulates. If there's no snapshot, compare against the `STEPS` array in the page.

2. **Decide the scope.** Wording-only changes need just the `STEPS` text. Renumbering, added or removed steps, or a changed loop structure need the engine, the nesting metadata and every place that refers to a step (see "Where steps are wired in" below). Ask the user only if a step is truly ambiguous in a way that changes the simulation; otherwise choose the most literal reading and mention it in the report.

3. **Update the engine** (`build()` in the page's script). Transcribe the new steps literally, with one `push()` per step. Do not fix bugs in the algorithm here. If the file has an off-by-one, the simulator should show the off-by-one; that's how the user finds it. If you notice a bug, say so in the report rather than correcting it in the page.

4. **Update everything that knows about steps** — see below.

5. **Check once, then publish.** Extract the page's inline script and run `node --check` on it to catch syntax errors. Don't build a screenshot or DOM-probing loop. Then republish (see "Publishing").

6. **Record the sync.** Copy the algorithm file to `.claude/simulator-sync/algorithm.txt` (create the folder if needed). The `UserPromptSubmit` hook compares against this snapshot, so skipping this makes it keep reporting the file as out of sync.

7. **Report briefly**: what changed in the algorithm, what changed on the page, any reading you chose for an ambiguous step, any bug you noticed in the algorithm, and that you did not view the page in a browser (unless you did).

## How the page is built

All logic is in one inline `<script>`; the parts below are what a sync touches.

**Engine — `build(q, seed)`** returns `{ events, symClass }`. It walks the algorithm and calls `push(step, msg, { op, warn, change, kind })` once per executed step:
- `step` is the step number as printed in the file. The step list, the "Step N" label and the timeline all key off it.
- `op` is `{ sym, cards: [cardIds] }` when the step adds a symbol to cards; the page replays ops to reconstruct any moment. Grid card id = `x + y*q`; vanishing point `k` = `q*q + k`.
- `warn` is an optional string shown in red, for a visible symptom of a problem (e.g. a card getting two symbols of the same direction).
- `change` is `{ rank, text }` when the step moves to a new card (rank 1), row (rank 2) or card group (rank 3). These drive the "New card / New row / New card group" badges, the "Pause on" setting, the Next card/row/group buttons and the timeline blocks. Put the change on the step where the position or direction actually moves.
- `kind` tags the events the drawing code needs to find: `'rowStart'` (position set to a row's first card; timeline ticks), `'cardMoved'`, and `'output'` (the last step; end of jumps). Put each tag on whichever step now does that job.
- The state object `st` carries what the panels display: `phase` (`setup` | `rows` | `done`), the loop variables `g` (card group, `q` = vertical), `i` (row) and `k` (card), plus `dir`, `pos`, `start` (row start, drawn as the **O** marker), `r`, `line` (card ids on the line being drawn) and `cls` (direction colour index). `vars` copies them for the variables panel; if the algorithm introduces or drops a variable, update `vars` and the `$('vars')` list in `render()` to match its names.
- Set a loop variable to `null` once its loop has finished (e.g. `st.k = null` after the card loop). The tracker reads `null` as "not in this loop".
- Symbols are drawn with a seeded `mulberry32` RNG so a seed reproduces a run. Match how the file picks symbols (currently: shuffle S once in step 1, then take from the end).

**Step list** — `STEPS` (index = step − 1) holds each step's text, shortened only enough to fit a narrow panel. `DEPTH` maps step → loop nesting depth (1 = inside the group loop, 2 = row loop, 3 = card loop); steps not listed are depth 0. `TAGS` adds small labels such as `new row` or `↻ card loop` to the steps that cause changes or close loops.

**Final result panel** — `renderCompare()` builds the finished deck for every q in `QS` and shows pass/fail for each. It needs no change unless `build()`'s signature changes.

**Comparing a step with a proposed fix** — if the user wants to see a buggy step next to its fix, add a `mode` argument to `build()`, a segmented control in the controls bar, and a second row per q in `renderCompare()`. Remove all of it once the file itself contains the fix; a toggle for a bug that's already fixed only confuses. (An earlier "Step 12: As written / Fixed" toggle was removed this way.)

## Where steps are wired in

The drawing code only uses step numbers in two places: the "Step N" label and the highlight in the step list. Everything else goes through `change`, `kind` and the loop variables. So a renumbering should only touch `build()`, `STEPS`, `DEPTH` and `TAGS`. As a check before finishing, search the script for `e.step`, `step ===` and `step >=`. Anything beyond those two uses is a new coupling: replace it with a `kind` tag.

## Publishing

The page is published at https://claude.ai/artifact/9BffDZMTQfev8cWbfC4TGx.
- If this conversation already published `tests/plane_tracer.html`, republish the same `file_path`; that keeps the URL.
- Otherwise, first read the artifact (`action: "read"` with that URL). If the live version differs from the local file, merge rather than overwrite. Then publish with `url` set to that link.
- Don't pass `icon` on a republish. A short `label` such as "Sync: loop rewrite" helps the version history.
