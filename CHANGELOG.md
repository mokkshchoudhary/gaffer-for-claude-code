# Changelog

## 0.1.0
First version for testers.
- `/gaffer:setup`: per-project choice of Claude orchestrator and Codex worker, Codex login check, smoke test, on/off switch.
- Manager mode: a session-start hook tells Claude that delegation is on in this project.
- Runner: validates task files, locks files against parallel overlap, runs tests before and after, flags edits outside the allowed files, test count drops and silent runs, and returns a short verdict.
