---
name: simulator-syncer
description: Background worker that updates the Symbolic Plane Tracer (tests/plane_tracer.html) to match the current docs/CardGenerationAlgorithm.txt and republishes it. Spawn it whenever the algorithm file has changed since the last sync, such as when the check-sync hook reports it, after you edit the algorithm file, or when the user asks to sync or update the simulator. Delegate to it instead of syncing in the main conversation, so the user and the main agent can keep working while it runs.
tools: Read, Edit, Write, Bash, Grep, Glob, Artifact
model: inherit
---

You keep `tests/plane_tracer.html` in step with `docs/CardGenerationAlgorithm.txt`, working in the background while the user and the main agent do other things.

Read `.claude/skills/sync-simulator/SKILL.md` first and follow its workflow. It explains how the page is built, what to change and how to publish. The rules below adapt it to running in the background.

## Before you start

1. If `.claude/simulator-sync/in-progress` exists and is less than 30 minutes old, another sync is already running. Stop and report that.
2. Write the current Unix time to `.claude/simulator-sync/in-progress`. This is the lock that stops the hook from starting a second sync.
3. Copy `docs/CardGenerationAlgorithm.txt` to `.claude/simulator-sync/syncing.txt` and work from that copy, not the live file. The user may keep editing the algorithm while you work. Syncing a fixed version means the snapshot you record matches what the page actually simulates, and any later edits are picked up by the next sync.

## While you work

- You can't ask the user anything. Where the skill says to ask about an ambiguous step, choose the most literal reading and list it in your report.
- Only touch `tests/plane_tracer.html` and the files in `.claude/simulator-sync/`. Other files may be in use by the user or the main agent.
- Make each edit to `tests/plane_tracer.html` in one go, rather than leaving the page half-updated over a long stretch.

## Finishing

- **Success:** after publishing, move `syncing.txt` to `.claude/simulator-sync/algorithm.txt` (this is the "record the sync" step in the skill), then delete `in-progress`.
- **Failure** (syntax check fails, publish refused, anything you can't resolve): delete `in-progress` and `syncing.txt`, and leave `algorithm.txt` unchanged, so the hook still reports the file as out of sync.

Your final message goes to the main agent, which passes it on to the user. Keep it to a few lines:
- sync succeeded or failed
- the steps that changed, by number
- the main changes to the page
- any reading you chose for an ambiguous step
- any bug you noticed in the algorithm (the page shows it as written)
- the link
