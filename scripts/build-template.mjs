#!/usr/bin/env node
/**
 * Build the browser generator's canonical template from the validated DramaConnect app.
 *
 * The template is deliberately BRAND-NEUTRAL. The build converts every
 * deployment-specific literal in the source app into a sentinel token, and the
 * browser replaces those tokens with the operator's own values at generation
 * time. This is the same mechanism already used for the Supabase credentials,
 * extended to cover the organisation name, application name, province, currency,
 * primary colour and search keywords.
 *
 * Why sentinels instead of replacing literal strings:
 *
 *   The previous approach replaced the literal text 'RCCG LP 25 Drama Department'
 *   and 'LP 25' directly. That forced the canonical template to physically contain
 *   those brand strings, so every generated site shipped with another
 *   organisation's identity baked in, and any file that happened to contain the
 *   substring 'LP 25' for an unrelated reason was silently rewritten. Sentinel
 *   tokens make the template neutral, the substitution deterministic, and the
 *   contract machine-checkable.
 *
 * Source location (no hard-coded path):
 *   --source <dir>            command-line argument
 *   DRAMACONNECT_SOURCE=<dir> environment variable
 *   otherwise                 auto-discover a sibling directory that looks like a
 *                             DramaConnect application
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const generatorRoot = path.resolve(here, '..');
const targetRoot = path.join(generatorRoot, 'templates', 'dramaconnect');

const excludedNames = new Set([
  '.git', 'node_modules', 'package.json', 'package-lock.json', 'tools',
  'AUDIT_AND_REMEDIATION_REPORT.md', 'scripts/build-complete-schema.mjs'
]);
const binaryExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz']);

/**
 * Ordered sentinel rules. Longest and most specific patterns MUST come first so
 * that a short pattern never consumes part of a longer one (for example, 'LP 25'
 * must never be matched inside 'RCCG LP 25 Drama Department' — by the time the
 * province rule runs, the organisation rule has already claimed that text).
 */
const SENTINEL_RULES = [
  { token: '__DC_ORG_NAME__', patterns: [/RCCG LP 25 Drama Department/g, /RCCG LP 25/g] },
  { token: '__DC_KEYWORDS__', patterns: [/rccg lp25 drama/gi] },
  { token: '__DC_APP_NAME__', patterns: [/DramaConnect Enterprise/g] },
  { token: '__DC_PROVINCE__', patterns: [/LP 25/g, /lp25/gi] },
  { token: '__DC_PRIMARY_COLOR__', patterns: [/#003399/gi] }
];

/** Config.js holds structured values that need token-level, not text-level, replacement. */
const CONFIG_TOKEN_RULES = [
  [/SUPABASE_URL:\s*'[^']*'/, "SUPABASE_URL: '__SUPABASE_URL__'"],
  [/SUPABASE_KEY:\s*'[^']*'/, "SUPABASE_KEY: '__SUPABASE_ANON_KEY__'"],
  [/CURRENCY:\s*'[^']*'/, "CURRENCY: '__DC_CURRENCY__'"]
];

const ALL_SENTINELS = [
  '__SUPABASE_URL__', '__SUPABASE_ANON_KEY__', '__DC_APP_NAME__', '__DC_ORG_NAME__',
  '__DC_PROVINCE__', '__DC_CURRENCY__', '__DC_PRIMARY_COLOR__', '__DC_KEYWORDS__'
];

function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }

function excluded(relative) {
  const normalized = relative.split(path.sep).join('/');
  return [...excludedNames].some((name) => normalized === name || normalized.startsWith(`${name}/`));
}

/** A directory qualifies as a DramaConnect app if it carries this shape. */
function looksLikeDramaConnectApp(dir) {
  const required = ['index.html', path.join('assets', 'js', 'config.js'), 'database', 'pages'];
  return required.every((entry) => fs.existsSync(path.join(dir, entry)));
}

function resolveSourceRoot() {
  const fromArg = process.argv.indexOf('--source');
  if (fromArg !== -1 && process.argv[fromArg + 1]) return path.resolve(process.argv[fromArg + 1]);
  if (process.env.DRAMACONNECT_SOURCE) return path.resolve(process.env.DRAMACONNECT_SOURCE);

  const parent = path.dirname(generatorRoot);
  let siblings = [];
  try {
    siblings = fs.readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(parent, entry.name))
      .filter((absolute) => absolute !== generatorRoot && !absolute.startsWith(targetRoot))
      .filter(looksLikeDramaConnectApp);
  } catch { /* parent unreadable; fall through to the error below */ }

  if (siblings.length === 1) return siblings[0];
  if (siblings.length > 1) {
    console.error(`Several candidate source applications were found next to the generator:\n  ${siblings.join('\n  ')}`);
    console.error('\nSelect one with --source <dir> or DRAMACONNECT_SOURCE=<dir>.');
    process.exit(1);
  }
  console.error('Could not locate the DramaConnect source application.');
  console.error('Pass --source <dir> or set DRAMACONNECT_SOURCE=<dir> to the validated app repository.');
  process.exit(1);
}

async function filesUnder(directory) {
  const output = [];
  async function visit(current) {
    for (const item of await fsp.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, item.name);
      const relative = path.relative(directory, absolute);
      if (excluded(relative)) continue;
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) await visit(absolute);
      else if (item.isFile()) output.push(relative);
    }
  }
  await visit(directory);
  return output.sort((a, b) => a.localeCompare(b));
}

/** Apply the sentinel rules to a text file's contents. */
function tokenizeText(text) {
  let output = text;
  for (const rule of SENTINEL_RULES) {
    for (const pattern of rule.patterns) output = output.replace(pattern, rule.token);
  }
  return output;
}

const sourceRoot = resolveSourceRoot();
await fsp.rm(targetRoot, { recursive: true, force: true });
await fsp.mkdir(targetRoot, { recursive: true });
const paths = await filesUnder(sourceRoot);
const entries = [];
const unresolved = new Map();

for (const relative of paths) {
  const source = path.join(sourceRoot, relative);
  const destination = path.join(targetRoot, relative);
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  let data = await fsp.readFile(source);
  const normalized = relative.split(path.sep).join('/');
  const binary = binaryExtensions.has(path.extname(relative).toLowerCase());

  if (!binary) {
    let text = data.toString('utf8');
    if (normalized === 'assets/js/config.js') {
      for (const [pattern, replacement] of CONFIG_TOKEN_RULES) text = text.replace(pattern, replacement);
    }
    text = tokenizeText(text);
    data = Buffer.from(text, 'utf8');
  }

  await fsp.writeFile(destination, data);
  entries.push({ path: normalized, bytes: data.byteLength, sha256: sha256(data), encoding: binary ? 'binary' : 'utf8' });
}

// Fail the build if any deployment-specific literal survived tokenisation.
const residualPattern = /RCCG LP 25|LP 25|lp25|DramaConnect Enterprise|fnhvilfamgadolnrwbpz|003399/i;
for (const entry of entries) {
  if (entry.encoding === 'binary') continue;
  const text = await fsp.readFile(path.join(targetRoot, entry.path), 'utf8');
  const match = text.match(residualPattern);
  if (match) unresolved.set(entry.path, match[0]);
}
if (unresolved.size) {
  console.error('Template still contains deployment-specific literals:');
  for (const [file, literal] of unresolved) console.error(`  ${file}: ${literal}`);
  process.exit(1);
}

const manifest = {
  format: 'dramaconnect-generator-template',
  formatVersion: 2,
  template: 'DramaConnect',
  release: '14.1',
  sentinels: ALL_SENTINELS,
  entryCount: entries.length,
  totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
  entries
};
await fsp.writeFile(path.join(targetRoot, '_template-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built DramaConnect template from ${path.relative(path.dirname(generatorRoot), sourceRoot)}: ${entries.length} files, ${manifest.totalBytes} bytes.`);
