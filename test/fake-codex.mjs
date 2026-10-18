// Stand-in for the Codex CLI so the runner can be tested without spending tokens.
// Behaviour is picked with FAKE_CODEX: ok | outside | deletetest | silent | fail | nologin | nowrite | research | long | limit | eperm
import fs from 'node:fs';

const args = process.argv.slice(2);
const mode = process.env.FAKE_CODEX || 'ok';

if (args[0] === '--version') { console.log('codex-cli 9.9.9 (fake)'); process.exit(0); }
if (args[0] === 'login') {
  if (mode === 'nologin') { console.log('Not logged in'); process.exit(1); }
  console.log('Logged in using ChatGPT'); process.exit(0);
}
if (args[0] === 'debug') {
  console.log(JSON.stringify({ models: [
    { slug: 'fake-mini', service_tiers: [{ id: 'priority' }] }, { slug: 'fake-max' }, { slug: 'fake-hidden', visibility: 'hide' },
  ] }));
  process.exit(0);
}

if (args[0] === 'exec') {
  const prompt = fs.readFileSync(0, 'utf8');
  const out = args[args.indexOf('-o') + 1];
  if (mode === 'silent') process.exit(0);
  console.log('thinking... '.repeat(30));
  if (mode === 'fail') { console.log('boom'); process.exit(3); }
  if (prompt.includes('reply with the single word OK')) {
    // nowrite: Codex answers but its sandbox blocked the file write (seen with Windows' elevated sandbox)
    if (mode === 'nowrite') console.log('Failed to create unified exec process: helper_unknown_error: setup refresh had errors');
    else fs.writeFileSync('ok.txt', 'OK');
    fs.writeFileSync(out, 'OK'); process.exit(0);
  }
  if (['ok', 'outside', 'limit', 'eperm'].includes(mode)) fs.appendFileSync('src/a.js', '\n// edited by fake codex\n');
  if (mode === 'outside') fs.appendFileSync('README.md', '\nedited\n');
  if (mode === 'deletetest') fs.rmSync('tests/two.test');
  if (mode === 'research') { fs.mkdirSync('.gaffer/research', { recursive: true }); fs.writeFileSync('.gaffer/research/notes.md', '# notes\n'); }
  if (mode === 'eperm') console.log('Vitest could not start: Error: spawn EPERM');
  // limit: stopped mid-task by the account's usage limit, without a final message
  if (mode === 'limit') { console.log("ERROR: You've hit your usage limit. Upgrade or try again at 8:30 PM."); process.exit(1); }
  const answer = `Did the thing (${mode}, sandbox ${args[args.indexOf('--sandbox') + 1]}).`;
  fs.writeFileSync(out, mode === 'long' ? Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join('\n') : answer);
  process.exit(0);
}
console.log(`fake codex: unknown args ${args.join(' ')}`);
process.exit(2);
