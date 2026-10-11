# Changelog

## 0.1.1
- Smoke test now uses the same write sandbox as real tasks and checks Codex really wrote a file. Before, it could pass while every task failed to write.
- Clear fix message when Codex's elevated Windows sandbox fails (`helper_unknown_error: setup refresh had errors`).
- Model list no longer shows service tiers or models Codex hides.

## 0.1.0
First version for testers.
- `/gaffer:setup`: per-project choice of Claude orchestrator and Codex worker, Codex login check, smoke test, on/off switch.
- Manager mode: a session-start hook tells Claude that delegation is on in this project.
- Runner: validates task files, locks files against parallel overlap, runs tests before and after, flags edits outside the allowed files, test count drops and silent runs, and returns a short verdict.
