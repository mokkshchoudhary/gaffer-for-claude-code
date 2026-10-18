---
name: delegate
description: Hand coding work to Codex and verify it. Use whenever gaffer manager mode is on in the project, or the user asks to send work to Codex.
allowed-tools: Bash(node *gaffer.mjs*)
---

# Delegating to Codex

You plan, decide and check. Codex reads, writes and runs. Your context is the expensive one, so keep bulk work out of it.

## Do it yourself
- Answering from what you have already read.
- An edit of a few lines in a file you already have open.
- Planning, splitting the work, writing task files, reading verdicts.
- Any task where the user says "do this yourself".

## Send to Codex
- Reading several files you haven't seen, or searching the codebase. Use a `readonly: true` task at `effort: low`.
- New files, or edits beyond a handful of lines.
- Writing or running tests, builds and long jobs.
- Debugging that needs more than one attempt.

If you're unsure, delegate.

## How
1. Write the brief to `.gaffer/tasks/<id>.md`. The format is in [reference/task-template.md](reference/task-template.md). Each task does one thing. A precise brief means fewer wrong guesses. Name the files, the expected behaviour, and the test command that proves it's done.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/gaffer.mjs" run .gaffer/tasks/<id>.md`. Runs take minutes, so start the command in the background and wait for it to finish. Don't poll the log. The verdict is also saved to `.gaffer/logs/<id>.verdict.txt`.
3. Read the verdict. It's the truth. Codex's own claims are not.
   - `PASS`: run `git diff --stat`, spot-check the riskiest file, and move on.
   - `FAIL`: read `.gaffer/logs/<id>.last.md`. Open the full log only if that doesn't explain it. Then fix the brief and rerun once, or do the fix yourself.
4. Run tasks in parallel only when their `files` lists don't overlap. The runner refuses overlapping tasks.

Tell the user what you sent to Codex in one line per task, and report results, not process.
