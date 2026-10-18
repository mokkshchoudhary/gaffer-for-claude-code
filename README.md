# gaffer for Claude Code

**Claude plans and checks. Codex does the work.**

gaffer turns Claude Code into a manager for OpenAI's Codex CLI. Claude keeps the thinking: planning, splitting work, deciding and reviewing. The token-heavy work goes to Codex: reading lots of files, writing code, running tests. A small runner script then checks Codex's work, so Claude never has to take its word for it.

You turn it on once per project. After that you work normally and Claude decides what to hand off.

> Unofficial community plugin. Not affiliated with Anthropic or OpenAI.

## What it checks on every Codex run

- The task file isn't empty. Without this, Codex "succeeds" while doing nothing.
- Tests run before and after. It fails if tests break, or if the number of tests drops (an agent deleting tests to go green is caught).
- Any file Codex changes outside the allowed list is flagged.
- A test command that can't start stops the run before Codex spends any tokens.
- A run that did nothing, stopped before finishing, or hit your Codex usage limit is named as such.
- Two tasks touching the same files can't run at the same time.
- Flaky suites (browser, server, timing) can be run 3 times.

Claude only gets a short verdict back, not Codex's full transcript:

```
STATUS: FAIL
task: fix-login-redirect (codex default, effort medium, 3.2 min)
changed: tests/auth/redirect.test.ts
tests: 41 passed -> 39 passed
problem: test count dropped from 41 to 39
codex says: Fixed the redirect and cleaned up the tests.
full log: .gaffer/logs/fix-login-redirect.log | codex summary: .gaffer/logs/fix-login-redirect.last.md
```

The verdict is also saved to `.gaffer/logs/<id>.verdict.txt`.

## Requirements

- [Claude Code](https://code.claude.com), running locally: terminal, VS Code, JetBrains or the desktop app. It won't work in cloud sessions, because they can't use your Codex login.
- [Codex CLI](https://github.com/openai/codex), logged in with a ChatGPT account or an OpenAI API key. Setup checks this and walks you through it.
- Node.js 18.18 or later. You already have it if you installed Codex with npm.
- Your project in a git repo. gaffer uses git to see exactly what Codex changed.

Works on Windows, macOS and Linux.

## Install

In your terminal:

```
claude plugin marketplace add mokkshchoudhary/gaffer-for-claude-code
claude plugin install gaffer@gaffer
```

Or inside Claude Code: `/plugin marketplace add mokkshchoudhary/gaffer-for-claude-code`, then `/plugin install gaffer@gaffer`.

**Turn on updates:** in Claude Code, open `/plugin`, go to **Marketplaces**, select **gaffer**, then choose **Enable auto-update**. Without this you stay on the version you installed.

## Set up a project

Open the project in Claude Code and run:

```
/gaffer:setup
```

It asks you, one question at a time:

1. Whether Codex is installed and logged in. If not, it shows you how to fix that.
2. Which Claude model orchestrates, and at what effort.
3. Which Codex model does the work. You choose from the models your account can see.
4. Which Codex effort to use. Medium is recommended.

It then runs a tiny smoke test, so you find out now and not halfway through a real task.

Choices are saved for that project only, in `.gaffer/config.json`. The Claude model is pinned in `.claude/settings.local.json`. Both are added to `.gitignore`, so everyone on a team picks their own. Run `/gaffer:setup` again any time to change models or turn manager mode off.

## How it works

- At the start of each session, a hook tells Claude whether manager mode is on in this project. It costs one short paragraph of context and nothing when it's off.
- Questions, planning and small edits stay with Claude. Exploring the codebase, bigger edits, tests and builds go to Codex. If you want Claude to do something itself, say "do this one yourself".
- For each piece of work, Claude writes a task file to `.gaffer/tasks/`, runs it, and reads only the verdict. Full Codex logs stay on disk in `.gaffer/logs/` and Claude opens them only when something failed.

Task file format:

```markdown
---
files: [src/auth/**, tests/auth/**]
test: npm test -- auth
effort: medium
---
What's wrong, where it lives, and what "done" means.
```

Optional fields: `id`, `flaky: true`, `network: true` (full access with internet and no sandbox, off by default), `sandbox: full` (no sandbox, network unchanged), `readonly: true` (questions about the code, no edits), `model`, `timeout` (minutes, for Codex and for each test run; default 30).

## Known limits in v0.2

- On Windows, Codex's default sandbox can't start JS test runners (`spawn EPERM`), so Codex can't run those tests while it works. gaffer's own before/after test runs still happen outside the sandbox. Set `sandbox: full` on tasks where Codex needs to run them itself.
- If the test suite already fails before Codex runs, every run FAILs, however good the change. Point `test:` at a part of the suite that passes.
- Test counts are read from jest, vitest, pytest, mocha and cargo output. For other runners, gaffer judges on the exit code only and says so in the verdict. If your `test:` wraps the runner in a script, make sure the runner's summary line still gets printed.
- Running tasks in parallel is blocked whenever their file patterns might overlap. This is deliberately cautious.
- Savings depend on your work and models. Measure on your own projects before quoting numbers.

## Turn it off or remove it

- For one project: `/gaffer:setup`, then choose "turn manager mode off".
- Everywhere: `claude plugin uninstall gaffer@gaffer`.

## Feedback

Open an issue using the bug template. Include your OS, Claude Code and Codex versions, and the verdict output.

## Development

```
npm test
```

The tests use a fake Codex in `test/fake-codex.mjs`, so they cost no tokens. CI runs them on Windows, macOS and Linux.

## License

MIT
