# Changelog

## 0.2.0
Verdicts you can trust more. Every fix below comes from real-world runs where the verdict was wrong or unclear.
- Files a task writes under `.gaffer/` (for example research notes) now count as changes, even when `.gaffer/` is gitignored. Before, such tasks always failed with "no files changed".
- Files written by gaffer's own baseline test run are no longer blamed on Codex.
- A test command that can't start (`command not found`, `not recognized`) stops the run before Codex is called, with a hint. Before, it was reported as "tests were already failing".
- A test run that hits the time limit is reported as a timeout, not as failing tests. Test runs now use the task's `timeout` (default 30 min) instead of a fixed 20.
- Hitting the Codex usage limit is named in the verdict, with the reset time. A long run that stopped without a final message is reported as stopped early, not as "probably did nothing". Flaky suites are run only once on unfinished work.
- Readonly answers longer than 60 lines say how many lines were cut and where the full answer is.
- The failing-test output in the verdict shows failure lines first, then the last 10 lines. Before, it showed only the last 3 lines.
- Codex may now run test suites that start and stop their own servers (E2E). The rule is now "don't leave servers running".
- New `sandbox: full` task option: no sandbox, without turning on network. The verdict notes when Codex hit `spawn EPERM` inside the sandbox.
- Every verdict is also saved to `.gaffer/logs/<id>.verdict.txt`.
- Test counts are now read from Node's built-in test runner (`node --test`), so the test-count drop check works for those projects too.
- CI fixed on Windows (a test didn't handle CRLF checkouts).

## 0.1.1
- Smoke test now uses the same write sandbox as real tasks and checks Codex really wrote a file. Before, it could pass while every task failed to write.
- Clear fix message when Codex's elevated Windows sandbox fails (`helper_unknown_error: setup refresh had errors`).
- Model list no longer shows service tiers or models Codex hides.

## 0.1.0
First version for testers.
- `/gaffer:setup`: per-project choice of Claude orchestrator and Codex worker, Codex login check, smoke test, on/off switch.
- Manager mode: a session-start hook tells Claude that delegation is on in this project.
- Runner: validates task files, locks files against parallel overlap, runs tests before and after, flags edits outside the allowed files, test count drops and silent runs, and returns a short verdict.
