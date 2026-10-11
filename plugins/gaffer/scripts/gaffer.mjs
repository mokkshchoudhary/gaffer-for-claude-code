#!/usr/bin/env node
// gaffer: Claude plans and checks, Codex does the work, this script enforces the rules.
// Zero dependencies. Commands: status | check | models | smoke | init | on | off | run | hook
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const CONFIG_VERSION = 1;
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh']; // 'max' can't be saved in settings
const TAIL = (s, n) => s.trim().split(/\r?\n/).slice(-n).join('\n');

// ---------- small helpers ----------

function parseFlags(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      flags[k] = v;
    } else pos.push(argv[i]);
  }
  return { pos, flags };
}

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  return r.status === 0 ? r.stdout : null;
}

function projectRoot(start = process.cwd()) {
  const top = git(start, ['rev-parse', '--show-toplevel']);
  return top ? path.resolve(top.trim()) : path.resolve(start);
}

const gafferDir = root => path.join(root, '.gaffer');
const configPath = root => path.join(gafferDir(root), 'config.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

function readConfig(root) {
  const c = readJson(configPath(root));
  if (!c) return null;
  // Future config versions add a migration here instead of breaking old projects.
  return { version: CONFIG_VERSION, enabled: true, codex: {}, claude: {}, ...c };
}

function die(msg, code = 2) { console.log(`ERROR: ${msg}`); process.exit(code); }

// ---------- finding and calling Codex ----------

export function findCodex(env = process.env) {
  if (env.CODEX_BIN) {
    return /\.[cm]?js$/.test(env.CODEX_BIN)
      ? { cmd: process.execPath, pre: [env.CODEX_BIN] }
      : { cmd: env.CODEX_BIN, pre: [] };
  }
  const win = process.platform === 'win32';
  const dirs = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  if (win && env.APPDATA) dirs.push(path.join(env.APPDATA, 'npm'));
  for (const d of dirs) {
    for (const ext of win ? ['.exe', '.cmd', ''] : ['']) {
      const p = path.join(d, 'codex' + ext);
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) continue;
      if (ext === '.cmd') {
        // Node refuses to spawn .cmd files without a shell, so run the npm package's JS entry directly.
        const js = path.join(d, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
        if (fs.existsSync(js)) return { cmd: process.execPath, pre: [js] };
        // shortcut: shell mode breaks on paths with spaces; fine for the default npm location
        return { cmd: p, pre: [], shell: true };
      }
      return { cmd: p, pre: [] };
    }
  }
  return null;
}

function codexSync(codex, args, opts = {}) {
  return spawnSync(codex.cmd, [...codex.pre, ...args], {
    encoding: 'utf8', timeout: opts.timeout ?? 60_000, input: opts.input, cwd: opts.cwd,
    shell: codex.shell, maxBuffer: 64 << 20,
  });
}

function codexRun(codex, args, input, { cwd, logFile, timeoutMs }) {
  return new Promise(resolve => {
    const fd = fs.openSync(logFile, 'w');
    const child = spawn(codex.cmd, [...codex.pre, ...args], { cwd, stdio: ['pipe', fd, fd], shell: codex.shell });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.on('error', err => { clearTimeout(timer); fs.closeSync(fd); resolve({ code: -1, timedOut, error: err.message }); });
    child.on('close', code => { clearTimeout(timer); fs.closeSync(fd); resolve({ code, timedOut }); });
    child.stdin.end(input);
  });
}

const INSTALL_HELP = `How to fix:
  Install Codex:            npm install -g @openai/codex
  Log in with ChatGPT:      codex login            (no browser? codex login --device-auth)
  Log in with an API key:   macOS/Linux: printenv OPENAI_API_KEY | codex login --with-api-key
                            PowerShell:  $env:OPENAI_API_KEY | codex login --with-api-key
  Codex somewhere unusual:  set CODEX_BIN to its full path
Then run the check again.`;

function check(root) {
  const lines = [`node: ${process.version}`];
  const isGit = git(root, ['rev-parse', '--is-inside-work-tree']) !== null;
  lines.push(`git repo: ${isGit ? 'yes' : 'NO (gaffer needs a git repo to check what Codex changed; run git init)'}`);
  const codex = findCodex();
  let ready = isGit && !!codex;
  if (!codex) {
    lines.push('codex: NOT FOUND');
  } else {
    const v = codexSync(codex, ['--version']);
    lines.push(`codex: ${(v.stdout || '').trim() || 'found, version unknown'} (${codex.pre[0] || codex.cmd})`);
    const login = codexSync(codex, ['login', 'status']);
    const loggedIn = login.status === 0;
    lines.push(`codex login: ${loggedIn ? (login.stdout || '').trim().split(/\r?\n/)[0] || 'yes' : 'NOT LOGGED IN'}`);
    ready = ready && loggedIn;
  }
  lines.push(`ready: ${ready ? 'yes' : 'no'}`);
  if (!codex || !ready) lines.push(INSTALL_HELP);
  return { ready, text: lines.join('\n') };
}

function models() {
  const codex = findCodex();
  if (!codex) die('codex not found. Run: node gaffer.mjs check');
  const r = codexSync(codex, ['debug', 'models']); // experimental command, so parse defensively
  const found = new Set();
  const walk = v => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      const id = v.slug ?? v.id ?? v.model;
      // Stop at a model entry: its nested objects (service tiers etc.) carry ids that aren't models.
      if (typeof id === 'string') { if (v.visibility !== 'hide') found.add(id); return; }
      Object.values(v).forEach(walk);
    }
  };
  try { walk(JSON.parse(r.stdout)); } catch { /* fall through */ }
  console.log(found.size
    ? `models:\n${[...found].slice(0, 30).map(m => `  ${m}`).join('\n')}`
    : 'models: list unavailable from this Codex version. Ask the user for the model name, or leave it empty to use Codex\'s default.');
}

const SANDBOX_HELP = `Codex could not run commands or write files in its sandbox, so real tasks would fail.
  Windows error "helper_unknown_error: setup refresh had errors" means Codex's elevated Windows sandbox failed.
  Fix: in ~/.codex/config.toml set   [windows]  sandbox = "unelevated"   then run the smoke test again.`;
const SANDBOX_BROKEN = /helper_unknown_error|setup refresh had errors/;

function smoke({ model, effort = 'low' }) {
  const codex = findCodex();
  if (!codex) die('codex not found. Run: node gaffer.mjs check');
  // Exercise the same write sandbox real tasks use: a read-only smoke can pass while every real run fails to write.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaffer-smoke-'));
  const out = path.join(dir, 'answer.txt');
  const args = ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--ephemeral', '--color', 'never',
    '-o', out, ...(model ? ['-m', model] : []), '-c', `model_reasoning_effort=${effort}`, '-'];
  const r = codexSync(codex, args, { input: 'Run a shell command that creates a file named ok.txt in the current directory containing OK. Then reply with the single word OK.', timeout: 180_000, cwd: dir });
  let answer = ''; try { answer = fs.readFileSync(out, 'utf8'); } catch {}
  const wrote = fs.existsSync(path.join(dir, 'ok.txt'));
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status === 0 && /\bOK\b/i.test(answer) && wrote) {
    console.log(`smoke: ok (model ${model || 'codex default'}, effort ${effort})`);
    return true;
  }
  const output = `${r.stdout || ''}\n${r.stderr || ''}${r.error ? '\n' + r.error.message : ''}`;
  const help = (r.status === 0 && !wrote) || SANDBOX_BROKEN.test(output) ? `\n${SANDBOX_HELP}` : '';
  console.log(`smoke: FAILED (model ${model || 'codex default'}, effort ${effort})\n${TAIL(output, 15)}${help}`);
  process.exitCode = 1;
  return false;
}

// ---------- project setup ----------

function ensureGitignore(root, entries) {
  if (git(root, ['rev-parse', '--is-inside-work-tree']) === null) return;
  const file = path.join(root, '.gitignore');
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const have = new Set(cur.split(/\r?\n/).map(l => l.trim()));
  const add = entries.filter(e => !have.has(e));
  if (add.length) fs.writeFileSync(file, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + add.join('\n') + '\n');
}

function init(root, f) {
  if (f['codex-effort'] && !EFFORTS.includes(f['codex-effort'])) die(`codex effort must be one of ${EFFORTS.join(', ')}`);
  if (f['claude-effort'] && !CLAUDE_EFFORTS.includes(f['claude-effort'])) die(`claude effort must be one of ${CLAUDE_EFFORTS.join(', ')} (max can only be set per session with /effort max)`);
  const old = readConfig(root) || {};
  const cfg = {
    version: CONFIG_VERSION,
    enabled: true,
    codex: { model: f['codex-model'] ?? old.codex?.model ?? null, effort: f['codex-effort'] ?? old.codex?.effort ?? 'medium' },
    claude: { model: f['claude-model'] ?? old.claude?.model ?? null, effort: f['claude-effort'] ?? old.claude?.effort ?? null },
  };
  writeJson(configPath(root), cfg);
  // Pin the orchestrator for this project only, so new sessions start on it.
  const settingsFile = path.join(root, '.claude', 'settings.local.json');
  const settings = readJson(settingsFile) || {};
  if (cfg.claude.model) settings.model = cfg.claude.model;
  if (cfg.claude.effort) settings.effortLevel = cfg.claude.effort;
  if (cfg.claude.model || cfg.claude.effort) writeJson(settingsFile, settings);
  ensureGitignore(root, ['.gaffer/', '.claude/settings.local.json']);
  console.log(`saved: ${path.relative(root, configPath(root))}\n${JSON.stringify(cfg)}`);
}

function setEnabled(root, enabled) {
  const cfg = readConfig(root);
  if (!cfg) die('no gaffer config in this project yet. Run /gaffer:setup first.');
  cfg.enabled = enabled;
  writeJson(configPath(root), cfg);
  console.log(`manager mode: ${enabled ? 'on' : 'off'}`);
}

function status(root) {
  const cfg = readConfig(root);
  console.log(cfg ? `config: ${JSON.stringify(cfg)}` : 'config: none (first-time setup)');
  const c = check(root);
  console.log(c.text);
}

function hook() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const cfg = readConfig(root);
  if (!cfg?.enabled) return;
  console.log(`gaffer manager mode is on for this project. Code changes beyond a few lines, codebase exploration, and test runs here are handed to Codex through the gaffer:delegate skill (Codex model: ${cfg.codex.model || 'Codex default'}, effort: ${cfg.codex.effort}). Answering questions, planning, and small edits stay with Claude. The user can change or switch this off with /gaffer:setup.`);
}

// ---------- tasks ----------

export function parseTask(raw, file = 'task.md') {
  const m = raw.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('task file must start with a --- frontmatter block');
  const meta = {};
  let lastKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && lastKey) { (meta[lastKey] = [].concat(meta[lastKey] || [])).push(unquote(item[1])); continue; }
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) throw new Error(`can't read frontmatter line: ${line}`);
    lastKey = kv[1];
    const v = kv[2].replace(/\s+#.*$/, '').trim(); // allow trailing "# comments"
    meta[lastKey] = v.startsWith('[') ? v.slice(1, -1).split(',').map(s => unquote(s.trim())).filter(Boolean)
      : v === 'true' ? true : v === 'false' ? false : v === '' ? [] : unquote(v);
  }
  const body = m[2].trim();
  const id = String(meta.id || path.basename(file).replace(/\.md$/i, ''));
  if (!/^[\w.-]+$/.test(id)) throw new Error(`task id "${id}" may only use letters, digits, . _ -`);
  if (body.length < 20) throw new Error('task file has no real instructions. Codex would "succeed" without doing anything.');
  const files = [].concat(meta.files || []);
  const readonly = meta.readonly === true;
  if (!readonly && !files.length) throw new Error('task needs a files: list (globs Codex may edit), or readonly: true');
  if (meta.effort && !EFFORTS.includes(meta.effort)) throw new Error(`effort must be one of ${EFFORTS.join(', ')}`);
  const timeout = Number(meta.timeout || 30);
  if (!(timeout > 0)) throw new Error('timeout must be minutes, e.g. timeout: 30');
  return { id, files, readonly, body, test: typeof meta.test === 'string' ? meta.test : '', effort: meta.effort,
    model: meta.model, network: meta.network === true, flaky: meta.flaky === true, timeout };
}

const unquote = s => s.replace(/^(['"])(.*)\1$/, '$2');

export function globToRegex(g) {
  let s = g.trim().replace(/^\.\//, '').replace(/\\/g, '/');
  if (s.endsWith('/')) s += '**';
  const re = s.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002')
    .replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
    .replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*');
  return new RegExp(`^${re}$`);
}

const staticPrefix = g => g.trim().replace(/^\.\//, '').split(/[*?[{]/)[0];

// shortcut: overlap compares the fixed part of each glob, so src/*.js and src/*.ts count as overlapping. Safe side; refine if it blocks real parallel work.
export function globsOverlap(a, b) {
  return a.some(x => b.some(y => { const p = staticPrefix(x), q = staticPrefix(y); return p.startsWith(q) || q.startsWith(p); }));
}

function snapshot(root) {
  const out = git(root, ['status', '--porcelain', '-z', '-uall']) ?? '';
  const parts = out.split('\0');
  const snap = {};
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const file = e.slice(3);
    if (/[RC]/.test(e.slice(0, 2))) i++; // rename/copy entries carry the old path next
    const abs = path.join(root, file);
    try { snap[file] = crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex'); } catch { snap[file] = 'deleted'; }
  }
  return snap;
}

function changedSince(before, after) {
  const all = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...all].filter(f => before[f] !== after[f] && !f.startsWith('.gaffer/')).sort();
}

export function countTests(output) {
  // Prefer a jest/vitest "Tests" summary line; skip "Test Suites"/"Test Files" lines that would double count.
  const lines = output.split(/\r?\n/);
  const summary = lines.filter(l => /^\s*Tests?\b:?\s/.test(l) && !/Test (Suites|Files)/.test(l));
  const text = summary.length ? summary.join('\n') : output;
  const sum = re => [...text.matchAll(re)].reduce((n, m) => n + Number(m[1]), 0);
  const passed = sum(/(\d+) (?:passed|passing)\b/g);
  const failed = sum(/(\d+) (?:failed|failing)\b/g);
  return passed + failed > 0 ? { passed, failed, total: passed + failed } : null;
}

function runTests(cmd, root, times) {
  let last = null, failedRuns = 0;
  for (let i = 0; i < times; i++) {
    const r = spawnSync(cmd, { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 20 * 60_000 });
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    if (r.status !== 0) failedRuns++;
    last = { code: r.status, counts: countTests(out), tail: TAIL(out, 3) };
  }
  return { ...last, failedRuns, times };
}

const fmtCounts = t => !t ? 'not run' : t.counts ? `${t.counts.passed} passed${t.counts.failed ? `, ${t.counts.failed} failed` : ''}` : `exit ${t.code} (count unknown)`;

function acquireLock(root, task) {
  const dir = path.join(gafferDir(root), 'locks');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) {
    const lock = readJson(path.join(dir, f));
    if (!lock) continue;
    let alive = true; try { process.kill(lock.pid, 0); } catch (e) { alive = e.code === 'EPERM'; }
    if (!alive) { fs.rmSync(path.join(dir, f), { force: true }); continue; }
    if (lock.id === task.id) die(`task "${task.id}" is already running (pid ${lock.pid}).`);
    if (globsOverlap(lock.files, task.files)) die(`task "${task.id}" may touch the same files as running task "${lock.id}" (${lock.files.join(', ')}). Run them one after another.`);
  }
  const file = path.join(dir, `${task.id}.json`);
  writeJson(file, { id: task.id, pid: process.pid, files: task.files, started: new Date().toISOString() });
  return file;
}

function buildPrompt(task) {
  const rules = task.readonly
    ? ['Do not create, edit or delete any files.', 'Put your answer in your final message: concise, with file paths and line numbers where useful.']
    : [`Only create or edit files matching: ${task.files.join(', ')}`, 'Do not commit, push, or create branches.',
       'Do not install or upgrade dependencies.', 'Do not start servers or other long-running processes.',
       'Never delete, skip, or weaken tests to make them pass.', 'Finish with a short plain summary of what you changed.'];
  return `${task.body}\n\n---\nRules for this run (set by gaffer, not negotiable):\n${rules.map(r => `- ${r}`).join('\n')}\n`;
}

async function run(root, taskFile) {
  if (!taskFile) die('usage: gaffer.mjs run <task-file.md>');
  if (git(root, ['rev-parse', '--is-inside-work-tree']) === null) die('not a git repo. gaffer needs git to check what Codex changed.');
  let raw;
  try { raw = fs.readFileSync(path.resolve(taskFile), 'utf8'); } catch { die(`task file not found: ${taskFile}`); }
  let task;
  try { task = parseTask(raw, taskFile); } catch (e) { die(e.message); }
  const cfg = readConfig(root) || { codex: {} };
  const codex = findCodex();
  if (!codex) die('codex not found. Run /gaffer:setup.');
  const model = task.model || cfg.codex.model || null;
  const effort = task.effort || cfg.codex.effort || 'medium';

  const lockFile = task.readonly ? null : acquireLock(root, task);
  try {
    const logs = path.join(gafferDir(root), 'logs');
    fs.mkdirSync(logs, { recursive: true });
    const logFile = path.join(logs, `${task.id}.log`);
    const lastFile = path.join(logs, `${task.id}.last.md`);
    fs.rmSync(lastFile, { force: true });

    const before = task.readonly ? null : snapshot(root);
    const testsBefore = task.test && !task.readonly ? runTests(task.test, root, 1) : null;

    const sandbox = task.readonly ? 'read-only' : task.network ? 'danger-full-access' : 'workspace-write';
    const args = ['exec', '--sandbox', sandbox, '--color', 'never', '-o', lastFile,
      ...(model ? ['-m', model] : []), '-c', `model_reasoning_effort=${effort}`, '-'];
    const t0 = Date.now();
    const res = await codexRun(codex, args, buildPrompt(task), { cwd: root, logFile, timeoutMs: task.timeout * 60_000 });
    const mins = ((Date.now() - t0) / 60_000).toFixed(1);

    const problems = [], notes = [];
    if (res.error) problems.push(`codex failed to start: ${res.error}`);
    else if (res.timedOut) problems.push(`codex timed out after ${task.timeout} min`);
    else if (res.code !== 0) problems.push(`codex exited with code ${res.code}`);
    const logSize = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
    const last = fs.existsSync(lastFile) ? fs.readFileSync(lastFile, 'utf8').trim() : '';
    if (logSize < 200 || !last) problems.push('codex produced almost no output, so it probably did nothing');
    if (logSize && SANDBOX_BROKEN.test(fs.readFileSync(logFile, 'utf8'))) problems.push(SANDBOX_HELP);
    if (task.network) notes.push('ran with full access (network on, no sandbox)');

    let changed = [], outside = [], testsAfter = null;
    if (!task.readonly) {
      changed = changedSince(before, snapshot(root));
      const res2 = task.files.map(globToRegex);
      outside = changed.filter(f => !res2.some(r => r.test(f)));
      if (!changed.length) problems.push('no files changed');
      if (outside.length) problems.push(`changed files outside the allowed list: ${outside.join(', ')}`);
      if (task.test) {
        testsAfter = runTests(task.test, root, task.flaky ? 3 : 1);
        if (testsAfter.failedRuns) problems.push(`tests failing after the change (${testsAfter.failedRuns}/${testsAfter.times} runs)`);
        const b = testsBefore.counts?.total, a = testsAfter.counts?.total;
        if (b != null && a != null && a < b) problems.push(`test count dropped from ${b} to ${a}`);
        if (testsBefore.code !== 0) notes.push('tests were already failing before Codex ran');
        if (!testsAfter.counts) notes.push('could not read a test count, judged on exit code only');
      } else notes.push('no test command given, nothing was verified by tests');
    }

    const pass = problems.length === 0;
    const out = [`STATUS: ${pass ? 'PASS' : 'FAIL'}`,
      `task: ${task.id} (codex ${model || 'default'}, effort ${effort}, ${mins} min)`];
    if (!task.readonly) {
      out.push(`changed: ${changed.length ? changed.slice(0, 10).join(', ') + (changed.length > 10 ? ` +${changed.length - 10} more` : '') : 'nothing'}`);
      if (task.test) out.push(`tests: ${fmtCounts(testsBefore)} -> ${fmtCounts(testsAfter)}`);
    }
    problems.forEach(p => out.push(`problem: ${p}`));
    notes.forEach(n => out.push(`note: ${n}`));
    if (task.readonly) out.push(`answer:\n${last.split(/\r?\n/).slice(0, 60).join('\n') || '(none)'}`);
    else out.push(`codex says: ${last.split(/\r?\n/).filter(Boolean).slice(0, 3).join(' / ').slice(0, 300) || '(nothing)'}`);
    if (!pass && testsAfter?.failedRuns) out.push(`test output tail:\n${testsAfter.tail}`);
    out.push(`full log: ${path.relative(root, logFile)} | codex summary: ${path.relative(root, lastFile)}`);
    console.log(out.join('\n'));
    process.exitCode = pass ? 0 : 1;
  } finally {
    if (lockFile) fs.rmSync(lockFile, { force: true });
  }
}

// ---------- entry ----------

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parseFlags(rest);
  const root = projectRoot();
  switch (cmd) {
    case 'status': return status(root);
    case 'check': { const c = check(root); console.log(c.text); process.exitCode = c.ready ? 0 : 1; return; }
    case 'models': return models();
    case 'smoke': return smoke({ model: flags.model, effort: flags.effort });
    case 'init': return init(root, flags);
    case 'on': return setEnabled(root, true);
    case 'off': return setEnabled(root, false);
    case 'run': return run(root, pos[0]);
    case 'hook': return hook();
    default: die('usage: gaffer.mjs status|check|models|smoke|init|on|off|run <task.md>|hook');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
