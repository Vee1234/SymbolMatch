#!/bin/bash
# UserPromptSubmit hook. Runs before each prompt and tells Claude when something has drifted
# out of sync, so it can deal with it. Silent when everything is in sync.
#
#   1. Simulator: docs/CardGenerationAlgorithm.txt changed since tests/plane_tracer.html was
#      last synced (snapshot written by the sync-simulator skill / simulator-syncer subagent).
#   2. README: commits since README.md's readme-synced-commit marker changed files the README
#      describes. Only committed changes count, so it doesn't nag during work in progress, and
#      it reminds once per commit.

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
messages=()

# ---------- 1. simulator ----------
algo="$root/docs/CardGenerationAlgorithm.txt"
sync_dir="$root/.claude/simulator-sync"
snap="$sync_dir/algorithm.txt"
lock="$sync_dir/in-progress"

check_simulator() {
  [ -f "$algo" ] || return
  local stale=""
  if [ -f "$lock" ]; then
    local started
    started=$(cat "$lock" 2>/dev/null)
    if [[ "$started" =~ ^[0-9]+$ ]] && [ $(( $(date +%s) - started )) -lt 1800 ]; then
      return # a sync is running; if the file changed again, a later prompt will say so
    fi
    stale=" A previous sync left a lock file older than 30 minutes and probably failed; delete .claude/simulator-sync/in-progress before starting a new one."
  fi
  local changes
  if [ ! -f "$snap" ]; then
    changes="(no snapshot from a previous sync)"
  elif ! cmp -s "$algo" "$snap"; then
    changes=$(diff -u "$snap" "$algo" | tail -n +3 | head -60)
  else
    return
  fi
  messages+=("docs/CardGenerationAlgorithm.txt has changed since tests/plane_tracer.html was last synced.${stale} Start the simulator-syncer subagent (Agent tool, subagent_type \"simulator-syncer\") to update the simulator in the background. Don't do the sync yourself. Carry on with the user's request, and mention the sync in one line. Changes since the last sync:
$changes")
}

# ---------- 2. README ----------
check_readme() {
  local readme="$root/README.md"
  [ -f "$readme" ] || return
  git -C "$root" rev-parse --git-dir >/dev/null 2>&1 || return
  local marker head reminded_file reminded changed
  marker=$(grep -o 'readme-synced-commit: [0-9a-f]*' "$readme" | cut -d' ' -f2)
  head=$(git -C "$root" rev-parse --short HEAD 2>/dev/null) || return
  [ -n "$marker" ] && [ "$marker" != "$head" ] || return
  reminded_file="$root/.claude/readme-check/last-reminded"
  reminded=$(cat "$reminded_file" 2>/dev/null)
  [ "$reminded" != "$head" ] || return
  changed=$(git -C "$root" diff --name-only "$marker" HEAD -- src tests wrangler.jsonc package.json '*.py' docs 2>/dev/null | head -20)
  [ -n "$changed" ] || return
  mkdir -p "$(dirname "$reminded_file")" && echo "$head" > "$reminded_file"
  messages+=("README.md may be out of date: commits since its last sync ($marker) changed files it describes. Use the update-readme skill to bring it up to date, after finishing whatever the user is asking for (or now, if they're asking about the README). Changed files:
$changed")
}

check_simulator
check_readme

[ ${#messages[@]} -gt 0 ] || exit 0
context=$(printf '%s\n\n' "${messages[@]}")
jq -n --arg ctx "$context" '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $ctx}}'
