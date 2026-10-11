// Stand-in for the Codex CLI so the runner can be tested without spending tokens.
// Behaviour is picked with FAKE_CODEX: ok | outside | deletetest | silent | fail | nologin
import fs from 'node:fs';

const args = process.argv.slice(2);
const mode = process.env.FAKE_CODEX || 'ok';

if (args[0] === '--version') { console.log('codex-cli 9.9.9 (fake)'); process.exit(0); }
if (args[0] === 'login') {
  if (mode === 'nologin') { console.log('Not logged in'); process.exit(1); }
  console.log('Logged in using ChatGPT'); process.exit(0);
}
if (args[0] === 'debug') { console.log(JSON.stringify({ models: [{ slug: 'fake-mini' }, { slug: 'fake-max' }] })); process.exit(0); }

if (args[0] === 'exec') {
  const prompt = fs.readFileSync(0, 'utf8');
  const out = args[args.indexOf('-o') + 1];
  if (mode === 'silent') process.exit(0);
  console.log('thinking... '.repeat(30));
  if (mode === 'fail') { console.log('boom'); process.exit(3); }
  if (prompt.includes('Reply with the single word OK')) { fs.writeFileSync(out, 'OK'); process.exit(0); }
  if (mode === 'ok' || mode === 'outside') fs.appendFileSync('src/a.js', '\n// edited by fake codex\n');
  if (mode === 'outside') fs.appendFileSync('README.md', '\nedited\n');
  if (mode === 'deletetest') fs.rmSync('tests/two.test');
  fs.writeFileSync(out, `Did the thing (${mode}).`);
  process.exit(0);
}
console.log(`fake codex: unknown args ${args.join(' ')}`);
process.exit(2);
