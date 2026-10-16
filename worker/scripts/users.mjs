// Lists accounts and resets PINs, straight against D1 through wrangler.
//
//   node scripts/users.mjs list                 [--local]
//   node scripts/users.mjs add <name>           [--local]
//   node scripts/users.mjs set-pin <name>       [--local]
//   node scripts/users.mjs link <name> <email>  [--local]
//   node scripts/users.mjs unlink <name>        [--local]
//
// (or npm run users -- <command> ...)
//
// This is the way back in when nobody can sign in. Before PBKDF2, PIN hashes
// were salted with whatever SESSION_SECRET held at the time, so rotating that
// secret locked every older account out, and /setup cannot help because users
// already exist. Setting LEGACY_PIN_SECRET to the old value fixes it if you
// still have it; this fixes it if you don't.
//
// It is a script rather than a route on purpose: it needs your Cloudflare
// login (the same one that can read the whole database anyway), so it adds no
// way in for anyone who only has the URL.
//
// link and unlink are for Cloudflare Access: they connect an account to the
// email Access signs that person in with (normally done once, from the app's
// "connect your list" page, with the account's PIN).
//
// add and set-pin ask for the PIN without echoing it. For scripted use, put it in
// LIGHTHOUSE_PIN instead; never pass it as an argument, where it would land in
// your shell history.
import { execFileSync } from 'node:child_process';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';

// Must match PIN_HASH_* in src/index.ts, or the Worker cannot verify the hash.
// 100,000 is Cloudflare's ceiling for PBKDF2; a higher count makes the Worker
// throw on every sign-in for that account.
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const DATABASE = 'lighthouse-watchlist';

const args = process.argv.slice(2);
const local = args.includes('--local');
const [command, name, email] = args.filter((a) => !a.startsWith('--'));

function d1(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', DATABASE, local ? '--local' : '--remote', '--json', '--command', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  // wrangler prints a JSON array of statement results.
  return JSON.parse(out.slice(out.indexOf('[')))[0];
}

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

function hashFormat(hash) {
  if (!hash) return 'no PIN set';
  if (hash.startsWith('pbkdf2$')) return `pbkdf2 (${hash.split('$')[1]} rounds)`;
  return 'legacy sha256 (upgraded on next sign-in)';
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (text) => { if (!muted) rl.output.write(text); };
    rl.question(question, (answer) => { rl.output.write('\n'); rl.close(); resolve(answer); });
    muted = true;
  });
}

if (command === 'list') {
  // SELECT * so this still works before migration 0004 adds the email column.
  const { results } = d1('SELECT * FROM users ORDER BY id');
  if (!results.length) {
    console.log('No accounts yet. Create the first one with: npm run users -- add <name>');
  }
  for (const row of results) {
    const linked = row.email ? `email ${row.email}` : 'no email linked';
    console.log(`${String(row.id).padStart(3)}  ${row.display_name.padEnd(20)} ${hashFormat(row.pin_hash).padEnd(42)} ${linked}`);
  }
} else if (command === 'link' && name && email) {
  const address = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(address)) {
    console.error(`"${email}" doesn't look like an email address. Nothing was changed.`);
    process.exit(1);
  }
  const taken = d1(`SELECT display_name FROM users WHERE email = ${quote(address)}`).results;
  if (taken.length && taken[0].display_name !== name) {
    console.error(`${address} already opens "${taken[0].display_name}". Unlink it first: npm run users -- unlink ${taken[0].display_name}`);
    process.exit(1);
  }
  const { results } = d1(`UPDATE users SET email = ${quote(address)} WHERE display_name = ${quote(name)} RETURNING id`);
  if (results.length !== 1) {
    console.error(`No account is called "${name}" (names are matched exactly here). Run "list" to see them.`);
    process.exit(1);
  }
  console.log(`${address} now opens "${name}" when signed in through Cloudflare Access.`);
} else if (command === 'unlink' && name) {
  const { results } = d1(`UPDATE users SET email = NULL WHERE display_name = ${quote(name)} RETURNING id`);
  if (results.length !== 1) {
    console.error(`No account is called "${name}". Run "list" to see them.`);
    process.exit(1);
  }
  console.log(`"${name}" has no email linked now. Its owner can connect again from the app.`);
} else if ((command === 'set-pin' || command === 'add') && name) {
  if (command === 'add') {
    // Same rule the Worker applies: names are unique ignoring case, because
    // sign-in matches them ignoring case.
    const { results } = d1(`SELECT id FROM users WHERE display_name = ${quote(name)} COLLATE NOCASE`);
    if (results.length) {
      console.error(`An account called "${name}" already exists. Use set-pin to change its PIN.`);
      process.exit(1);
    }
  }
  const pin = process.env.LIGHTHOUSE_PIN ?? await askHidden(`${command === 'add' ? 'PIN' : 'New PIN'} for "${name}" (4-10 digits): `);
  if (!/^[0-9]{4,10}$/.test(pin)) {
    console.error('A PIN is 4 to 10 digits. Nothing was changed.');
    process.exit(1);
  }
  const salt = randomBytes(SALT_BYTES);
  const hash = pbkdf2Sync(pin, salt, ITERATIONS, KEY_BYTES, 'sha256');
  const stored = `pbkdf2$${ITERATIONS}$${salt.toString('hex')}$${hash.toString('hex')}`;
  if (command === 'add') {
    d1(`INSERT INTO users (display_name, pin_hash) VALUES (${quote(name)}, ${quote(stored)})`);
    console.log(`Account "${name}" created on the ${local ? 'local' : 'remote'} database. It starts with an empty list.`);
    process.exit(0);
  }
  // RETURNING rather than meta.changes: local D1 does not report a change count.
  const { results } = d1(`UPDATE users SET pin_hash = ${quote(stored)} WHERE display_name = ${quote(name)} RETURNING id`);
  if (results.length !== 1) {
    console.error(`No account is called "${name}" (names are matched exactly here). Run "list" to see them.`);
    process.exit(1);
  }
  console.log(`PIN updated for "${name}" on the ${local ? 'local' : 'remote'} database. Sign in with it now.`);
} else {
  console.log([
    'Usage (add --local to use the local database):',
    '  npm run users -- list',
    '  npm run users -- add <name>',
    '  npm run users -- set-pin <name>',
    '  npm run users -- link <name> <email>',
    '  npm run users -- unlink <name>',
  ].join('\n'));
  process.exit(command ? 1 : 0);
}
