# Task file format

```markdown
---
id: fix-login-redirect        # names the log; letters, digits, . _ - (defaults to the file name)
files: [src/auth/**, tests/auth/**]   # globs Codex may edit; anything else changed = FAIL
test: npm test -- auth        # run before and after; failures or fewer tests = FAIL
effort: medium                # optional; overrides the project default (low | medium | high | xhigh)
flaky: true                   # optional; runs the tests 3 times (browser, server or timing tests)
network: true                 # optional; full access with internet and no sandbox. Only when the task needs the web
timeout: 30                   # optional; minutes, default 30
---
What's wrong: after login, users land on /home instead of the page they came from.
Where: src/auth/redirect.ts sets the target; tests in tests/auth/redirect.test.ts.
Build: keep the `next` query param through the OAuth round trip.
Done when: the new test "returns to original page" passes and all auth tests pass.
```

For exploration with no edits, set `readonly: true`, leave out `files` and `test`, and ask a specific question. The answer comes back in the verdict.
