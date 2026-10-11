---
name: setup
description: Set up or change gaffer for this project. Picks the Claude orchestrator model and effort, checks Codex login, picks the Codex model and effort, and turns manager mode on or off.
disable-model-invocation: true
allowed-tools: Bash(node *gaffer.mjs*)
---

# gaffer setup

Settings are per project. Walk the user through these steps in order. Use the AskUserQuestion tool for every choice. When a setting already exists, offer it as the first option labelled "(current)".

The runner command is:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gaffer.mjs"
```

It is called `GAFFER` below. Run it from the project root.

## 1. Current state
Run `GAFFER status`.
- If a config exists, ask first: change settings, turn manager mode off (`GAFFER off`), or turn it back on (`GAFFER on`).
- If the user picks off or on, run that command and stop.

## 2. Codex check
If `ready: no`, show the user the "How to fix" lines from the output and tell them to run the fix in their own terminal. Codex login opens a browser, so they have to do it themselves. Wait until they say it's done, then run `GAFFER check` again. Do not continue until it shows `ready: yes`. If the problem is that the project isn't a git repo, offer to run `git init`.

## 3. Orchestrator (Claude)
Tell the user which Claude model you are running on right now. Then ask which model should orchestrate in this project. Offer these options:
- `best` (Fable when available, otherwise the latest Opus): strongest planning and checking. Best for large or multi-file work.
- `opus`: very strong planner and reviewer. A good default.
- `sonnet`: fine for small, well-defined work. Weaker at catching a worker that claims success it didn't earn.
- Keep the current model.

Then ask for the effort level:
- `low`: quick back-and-forth.
- `medium`: the default on the newest models, and right for most work.
- `high`: careful planning for tricky work.
- `xhigh`: deepest effort that can be saved as the default.

`max` can't be saved as a default. Tell users who want it to type `/effort max` in a session.

## 4. Codex model
Run `GAFFER models` and offer up to three of the listed models, plus "Codex default". If no list comes back, ask the user to type the model name or pick "Codex default".

## 5. Codex effort
Ask for Codex's effort level:
- `low`: lookups, renames, small single-file edits, reading and summarising code.
- `medium` (Recommended): most features and bug fixes across a few files, plus writing tests.
- `high`: tricky bugs, refactors across many files, failures with no obvious cause. Slower and costs more.

Single tasks can still override the effort.

## 6. Smoke test
Run `GAFFER smoke --model <model> --effort <effort>`. Leave out `--model` when the user picked "Codex default". This costs a few tokens and proves that the account can use the model.
- If the output says `smoke: FAILED`, show the user the error and go back to step 4.

## 7. Save
Run this, leaving out any flag the user didn't set:

```
GAFFER init --codex-model <m> --codex-effort <e> --claude-model <m> --claude-effort <e>
```

This saves `.gaffer/config.json` and pins the Claude model in `.claude/settings.local.json`. It also adds both to `.gitignore`.

## 8. Confirm
Give a 3-line summary: the orchestrator, the worker, and that manager mode is on. The Claude model setting applies from the next session. To switch the current session now, type `/model <m>` and `/effort <e>`. To change anything later, run `/gaffer:setup` again.
