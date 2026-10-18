// Runs on Windows, macOS and Linux: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTask, globToRegex, globsOverlap, countTests, failureTail } from '../plugins/gaffer/scripts/gaffer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const GAFFER = path.join(here, '..', 'plugins', 'gaffer', 'scripts', 'gaffer.mjs');
const FAKE = path.join(here, 'fake-codex.mjs');

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaffer-test-'));
  const sh = (...a) => spawnSync('git', a, { cwd: dir });
  sh('init', '-q'); sh('config', 'user.email', 't@t'); sh('config', 'user.name', 't');
  fs.mkdirSync(path.join(dir, 'src')); fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# demo\n');
  fs.writeFileSync(path.join(dir, 'tests', 'one.test'), '');
  fs.writeFileSync(path.join(dir, 'tests', 'two.test'), '');
  // A tiny "test runner": one passing test per file in tests/
  fs.writeFileSync(path.join(dir, 'runtests.js'),
    "const n = require('fs').readdirSync('tests').length; console.log(`Tests: ${n} passed, ${n} total`);\n");
  sh('add', '-A'); sh('commit', '-qm', 'init');
  return dir;
}

function gaffer(dir, args, env = {}, input) {
  const r = spawnSync(process.execPath, [GAFFER, ...args], {
    cwd: dir, encoding: 'utf8', input,
    env: { ...process.env, CODEX_BIN: FAKE, ...env },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

function writeTask(dir, name, front, body = 'Add a comment to src/a.js explaining what the constant is for.') {
  const p = path.join(dir, `${name}.md`);
  fs.writeFileSync(p, `---\n${front}\n---\n${body}\n`);
  return p;
}

const TASK = 'files: [src/**]\ntest: node runtests.js';

test('PASS when Codex edits only allowed files and tests hold', () => {
  const dir = makeRepo();
  const r = gaffer(dir, ['run', writeTask(dir, 'ok', TASK)]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /STATUS: PASS/);
  assert.match(r.out, /tests: 2 passed -> 2 passed/);
  assert.match(fs.readFileSync(path.join(dir, '.gaffer', 'logs', 'ok.verdict.txt'), 'utf8'), /STATUS: PASS/);
});

test('counts task output under a gitignored .gaffer/ as a change', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, '.gitignore'), '.gaffer/\n');
  const r = gaffer(dir, ['run', writeTask(dir, 'research', 'files: [.gaffer/research/**]')], { FAKE_CODEX: 'research' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /changed: \.gaffer\/research\/notes\.md\n/);
});

test('files written by the baseline test run are not blamed on Codex', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, 'porttests.js'), "require('fs').writeFileSync('port.tmp', String(Math.random())); require('./runtests.js');\n");
  const r = gaffer(dir, ['run', writeTask(dir, 'port', 'files: [src/**]\ntest: node porttests.js')]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /port\.tmp/);
});

test('usage limit is named, and partial edits are not called "did nothing"', () => {
  const dir = makeRepo();
  const r = gaffer(dir, ['run', writeTask(dir, 'limit', TASK)], { FAKE_CODEX: 'limit' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /usage limit \(resets 8:30 PM\)/);
  assert.match(r.out, /changed: src\/a\.js/);
  assert.doesNotMatch(r.out, /did nothing/);
});

test('refuses to run Codex when the test command cannot start', () => {
  const dir = makeRepo();
  const r = gaffer(dir, ['run', writeTask(dir, 'nocmd', 'files: [src/**]\ntest: gaffer-no-such-command-xyz')]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /test command could not start, so Codex was not run/);
  assert.ok(!fs.existsSync(path.join(dir, '.gaffer', 'logs', 'nocmd.log')));
  assert.deepEqual(fs.readdirSync(path.join(dir, '.gaffer', 'locks')), []);
});

test('a test command that runs too long is reported as a timeout, not failing tests', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, 'slow.js'), 'setTimeout(() => {}, 6000);\n');
  const r = gaffer(dir, ['run', writeTask(dir, 'slow', 'files: [src/**]\ntest: node slow.js\ntimeout: 0.04')]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /test command timed out after 0\.04 min/);
  assert.doesNotMatch(r.out, /tests failing/);
});

test('sandbox: full runs without a sandbox; spawn EPERM inside the sandbox is noted', () => {
  const dir = makeRepo();
  const full = gaffer(dir, ['run', writeTask(dir, 'full', 'files: [src/**]\nsandbox: full')]);
  assert.match(full.out, /sandbox danger-full-access/);
  assert.match(full.out, /ran with full access \(no sandbox\)/);
  const eperm = gaffer(dir, ['run', writeTask(dir, 'eperm', TASK)], { FAKE_CODEX: 'eperm' });
  assert.equal(eperm.code, 0, eperm.out);
  assert.match(eperm.out, /note: Codex could not start processes inside its sandbox \(spawn EPERM\)/);
});

test('FAIL when Codex edits a file outside the allowed list', () => {
  const dir = makeRepo();
  const r = gaffer(dir, ['run', writeTask(dir, 'out', TASK)], { FAKE_CODEX: 'outside' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /outside the allowed list: README\.md/);
});

test('FAIL when Codex deletes a test to go green', () => {
  const dir = makeRepo();
  const r = gaffer(dir, ['run', writeTask(dir, 'del', 'files: [tests/**]\ntest: node runtests.js')], { FAKE_CODEX: 'deletetest' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /test count dropped from 2 to 1/);
});

test('FAIL when Codex exits quietly having done nothing', () => {
  const dir = makeRepo();
  const r = gaffer(dir, ['run', writeTask(dir, 'quiet', TASK)], { FAKE_CODEX: 'silent' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /almost no output/);
  assert.match(r.out, /no files changed/);
});

test('refuses an empty task file before calling Codex', () => {
  const dir = makeRepo();
  const r = gaffer(dir, ['run', writeTask(dir, 'empty', TASK, '')]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /no real instructions/);
});

test('refuses to start when a running task holds overlapping files', () => {
  const dir = makeRepo();
  fs.mkdirSync(path.join(dir, '.gaffer', 'locks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.gaffer', 'locks', 'other.json'),
    JSON.stringify({ id: 'other', pid: process.pid, files: ['src/a.js'] }));
  const r = gaffer(dir, ['run', writeTask(dir, 'clash', TASK)]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /same files as running task "other"/);
});

test('readonly task returns the answer and needs no files list', () => {
  const dir = makeRepo();
  const r = gaffer(dir, ['run', writeTask(dir, 'look', 'readonly: true\neffort: low', 'Find where the constant a is defined and report the file.')]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /answer:\nDid the thing/);
  const long = gaffer(dir, ['run', writeTask(dir, 'long', 'readonly: true', 'Describe every module in this repo in detail.')], { FAKE_CODEX: 'long' });
  assert.match(long.out, /line 60\n\(\+20 more lines in \.gaffer[\\/]logs[\\/]long\.last\.md\)/);
});

test('init saves config, pins Claude model per project, gitignores; hook speaks only when on', () => {
  const dir = makeRepo();
  assert.equal(gaffer(dir, ['hook'], {}, JSON.stringify({ cwd: dir })).out.trim(), '');
  gaffer(dir, ['init', '--codex-model', 'fake-mini', '--codex-effort', 'medium', '--claude-model', 'opus', '--claude-effort', 'high']);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8'));
  assert.deepEqual(settings, { model: 'opus', effortLevel: 'high' });
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /\.gaffer\/\n\.claude\/settings\.local\.json/);
  assert.match(gaffer(dir, ['hook'], { CLAUDE_PROJECT_DIR: dir }, '{}').out, /manager mode is on.*fake-mini/);
  gaffer(dir, ['off']);
  assert.equal(gaffer(dir, ['hook'], { CLAUDE_PROJECT_DIR: dir }, '{}').out.trim(), '');
});

test('check reports missing login with fix instructions; smoke passes on a working model', () => {
  const dir = makeRepo();
  const bad = gaffer(dir, ['check'], { FAKE_CODEX: 'nologin' });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /NOT LOGGED IN[\s\S]*codex login/);
  assert.match(gaffer(dir, ['smoke', '--model', 'fake-mini']).out, /smoke: ok/);
  const noWrite = gaffer(dir, ['smoke'], { FAKE_CODEX: 'nowrite' });
  assert.equal(noWrite.code, 1, noWrite.out);
  assert.match(noWrite.out, /smoke: FAILED[\s\S]*sandbox = "unelevated"/);
  const models = gaffer(dir, ['models']).out;
  assert.match(models, /fake-mini[\s\S]*fake-max/);
  assert.doesNotMatch(models, /priority|fake-hidden/);
});

test('pure helpers', () => {
  assert.ok(globToRegex('src/**/*.ts').test('src/a/b.ts'));
  assert.ok(globToRegex('src/**/*.ts').test('src/b.ts'));
  assert.ok(!globToRegex('src/*.ts').test('src/a/b.ts'));
  assert.ok(globToRegex('docs/').test('docs/x/y.md'));
  assert.ok(globsOverlap(['src/**'], ['src/a.js']));
  assert.ok(!globsOverlap(['src/**'], ['docs/**']));
  assert.deepEqual(countTests('Test Suites: 1 failed, 2 passed\nTests:       1 failed, 9 passed, 10 total'), { passed: 9, failed: 1, total: 10 });
  assert.deepEqual(countTests(' Test Files  2 passed (2)\n      Tests  7 passed (7)'), { passed: 7, failed: 0, total: 7 });
  assert.deepEqual(countTests('===== 3 passed, 1 failed in 0.2s ====='), { passed: 3, failed: 1, total: 4 });
  assert.deepEqual(countTests('  12 passing (40ms)\n  2 failing'), { passed: 12, failed: 2, total: 14 });
  assert.equal(countTests('ok  example.com/pkg 0.01s'), null);
  assert.deepEqual(countTests('ℹ tests 10\nℹ suites 0\nℹ pass 9\nℹ fail 1\nℹ cancelled 0'), { passed: 9, failed: 1, total: 10 });
  assert.deepEqual(countTests('ok 3 - c\n# tests 3\r\n# pass 3\r\n# fail 0\r\n'), { passed: 3, failed: 0, total: 3 });
  assert.throws(() => parseTask('no frontmatter'), /frontmatter/);
  const t = parseTask('---\nid: x\nfiles:\n  - src/**\n  - "lib/*.js"\nflaky: true\n---\nDo a reasonably described job here please.');
  assert.deepEqual(t.files, ['src/**', 'lib/*.js']);
  assert.equal(t.flaky, true);
  assert.throws(() => parseTask('---\nfiles: [a]\nsandbox: off\n---\nDo a reasonably described job here please.'), /sandbox/);
  const tail = failureTail(['FAIL tests/x.test.ts > returns to page', ...Array.from({ length: 30 }, (_, i) => `[WebServer] log ${i}`)].join('\n'));
  assert.match(tail, /^FAIL tests\/x\.test\.ts[\s\S]*\[WebServer\] log 29$/);
  // The shipped template must parse as written, comments and all. \r?: Windows checkouts may use CRLF.
  const tpl = fs.readFileSync(path.join(here, '..', 'plugins', 'gaffer', 'skills', 'delegate', 'reference', 'task-template.md'), 'utf8');
  const fromTpl = parseTask(tpl.match(/```markdown\r?\n([\s\S]*?)```/)[1]);
  assert.equal(fromTpl.id, 'fix-login-redirect');
  assert.deepEqual(fromTpl.files, ['src/auth/**', 'tests/auth/**']);
  assert.equal(fromTpl.test, 'npm test -- auth');
  assert.equal(fromTpl.timeout, 30);
});
