// Checks the documentation against the repository, so the docs can't quietly
// drift from the code. Every claim a reader would act on is checked:
//
//   - every relative link and image resolves, including #anchors into headings;
//   - every `npm run x` the docs tell you to run exists;
//   - every file path in backticks exists;
//   - every route in the configuration table is handled by the Worker;
//   - every secret and setting the Worker reads is documented, and the docs
//     name none that it doesn't read;
//   - the Node version the docs ask for is the one package.json requires;
//   - no database id, key or token appears anywhere in the docs.
//
//   node scripts/verify-docs.mjs        (npm run verify runs it after the tests)
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(WORKER, '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) pass++; else fail++;
  if (!ok || process.argv.includes('--verbose')) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' - ' + extra : ''}`);
};

const mdFiles = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md',
  ...readdirSync(resolve(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`),
  'docs/brand/README.md', 'examples/instance/README.md'];
const current = mdFiles.filter((f) => f !== 'CHANGELOG.md');
const docs = Object.fromEntries(mdFiles.map((f) => [f, read(f)]));
// Code blocks are checked for commands, but their contents are not links.
const prose = (text) => text.replace(/```[\s\S]*?```/g, '');

// GitHub's heading anchors: lower-case, punctuation dropped, spaces to hyphens.
function anchors(markdown) {
  const out = new Set();
  for (const m of prose(markdown).matchAll(/^#{1,6}\s+(.+)$/gm)) {
    out.add(m[1].trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-'));
  }
  return out;
}

console.log('Links and images resolve');
for (const [file, text] of Object.entries(docs)) {
  const targets = [
    ...[...prose(text).matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]),
    ...[...text.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]),
  ];
  for (const target of targets) {
    if (/^(https?:|mailto:)/.test(target)) continue;
    const [path, anchor] = target.split('#');
    const resolved = path ? resolve(ROOT, dirname(file), path) : resolve(ROOT, file);
    const where = `${file} -> ${target}`;
    if (!existsSync(resolved)) { check(where, false, 'no such file'); continue; }
    if (anchor && resolved.endsWith('.md')) {
      check(where, anchors(readFileSync(resolved, 'utf8')).has(anchor), 'no such heading');
    } else {
      check(where, true);
    }
  }
}

console.log('Commands exist');
const pkg = JSON.parse(read('worker/package.json'));
const scripts = new Set();
for (const text of Object.values(docs)) {
  for (const m of text.matchAll(/npm run ([a-z0-9:-]+)/g)) scripts.add(m[1]);
}
for (const s of scripts) check(`npm run ${s}`, typeof pkg.scripts[s] === 'string');
check('npm test', typeof pkg.scripts.test === 'string');

console.log('File paths in backticks exist');
// Files a reader creates themselves, or that a build produces.
const createdByYou = new Set(['wrangler.toml', '.dev.vars', 'backup.sql']);
for (const file of current) {
  for (const m of prose(docs[file]).matchAll(/`([A-Za-z0-9_./-]+\.(?:ts|mjs|js|json|toml|sql|md|png|svg|example))`/g)) {
    const p = m[1];
    // A leading slash is a URL path on the Worker, not a file.
    if (p.startsWith('/') || createdByYou.has(p.split('/').pop())) continue;
    const found = [resolve(ROOT, dirname(file)), ROOT, WORKER, resolve(WORKER, 'src'), resolve(WORKER, 'src/ai'), resolve(WORKER, 'src/assets'), resolve(WORKER, 'scripts')]
      .some((base) => existsSync(resolve(base, p)));
    check(`${file}: \`${p}\``, found, 'not found');
  }
}

console.log('Routes in the configuration table are handled');
const code = read('worker/src/index.ts');
// The AI provider settings are declared next to the providers that read them.
const aiCode = readdirSync(resolve(WORKER, 'src/ai')).filter((f) => f.endsWith('.ts')).map((f) => read(`worker/src/ai/${f}`)).join('\n');
const routeRows = docs['docs/configuration.md'].split('\n').filter((l) => /^\| `(GET|POST|PATCH|DELETE) \//.test(l));
check('routes table found', routeRows.length > 10, `${routeRows.length} routes`);
for (const row of routeRows) {
  const [, method, path] = row.match(/^\| `(GET|POST|PATCH|DELETE) ([^`]+)`/);
  const literal = path.replace(/\/:id.*$/, '/');
  const handled = path.includes(':id')
    ? code.includes(`request.method === "${method}"`) && code.includes('items')
    : code.includes(`"${path}"`);
  check(`${method} ${path}`, handled);
  if (path.includes(':id')) check(`${method} ${path} has a pattern`, code.includes(literal.slice(1, -1)));
}

console.log('Settings: everything read is documented, and nothing else is');
// Every UPPER_CASE field of an exported interface is a setting the Worker reads.
const settingsIn = (source) => [...source.matchAll(/export interface \w+(?: extends [^{]+)? \{([^}]*)\}/g)]
  .flatMap((m) => [...m[1].matchAll(/^\s+([A-Z][A-Z0-9_]+)\??:/gm)].map((f) => f[1]));
// DB is the D1 binding declared in wrangler.toml, not a setting anyone sets.
const envNames = [...new Set([...settingsIn(code), ...settingsIn(aiCode)])].filter((n) => n !== 'DB');
check('settings found', envNames.length >= 15, `${envNames.length} settings`);
const config = docs['docs/configuration.md'];
for (const name of envNames) check(`${name} is documented in configuration.md`, config.includes(`\`${name}\``));
const documented = [...config.matchAll(/^\| `([A-Z][A-Z0-9_]+)`/gm)].map((m) => m[1]);
for (const name of documented) check(`${name} (documented) is read by the Worker`, envNames.includes(name));
const devVars = read('worker/.dev.vars.example');
for (const name of envNames) check(`${name} is in .dev.vars.example`, devVars.includes(`${name}=`));

console.log('Node version');
const node = (pkg.engines?.node || '').replace(/[^0-9.]/g, '');
for (const file of ['README.md', 'docs/setup.md', 'CONTRIBUTING.md']) {
  check(`${file} asks for Node ${node}`, docs[file].includes(`Node.js ${node}`) || docs[file].includes(`Node ${node}`));
}

console.log('No identifiers or secrets');
for (const [file, text] of Object.entries({ ...docs, 'worker/.dev.vars.example': devVars, 'worker/wrangler.template.toml': read('worker/wrangler.template.toml') })) {
  check(`${file}: no database_id value`, !/database_id\s*=\s*["'][0-9a-f-]{36}["']/.test(text));
  check(`${file}: no uuid`, !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(text));
  check(`${file}: no bot token`, !/[0-9]{8,12}:[A-Za-z0-9_-]{30,}/.test(text));
  check(`${file}: no API key`, !/sk-[a-z]+-v1-|sk-ant-|AIza[0-9A-Za-z_-]{20,}/.test(text));
}
check('license is MIT', pkg.license === 'MIT' && existsSync(resolve(ROOT, 'LICENSE')) && /MIT/.test(docs['README.md']));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
