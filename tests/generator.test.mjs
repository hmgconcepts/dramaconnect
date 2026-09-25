#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto, { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TextDecoder, TextEncoder } from 'node:util';
import { JSDOM } from 'jsdom';
import { transform } from 'esbuild';
import JSZip from 'jszip';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templateRoot = path.join(root, 'templates', 'dramaconnect');
const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
const source = await fs.readFile(path.join(root, 'assets/js/generator.js'), 'utf8');
const manifest = JSON.parse(await fs.readFile(path.join(templateRoot, '_template-manifest.json'), 'utf8'));
const digest = (data) => crypto.createHash('sha256').update(data).digest('hex');

// Static browser parsing and bundler validation.
await transform(source, { loader: 'js', target: 'es2020', sourcefile: 'assets/js/generator.js' });
const parsed = new JSDOM(html);
assert.equal(parsed.window.document.querySelectorAll('[data-panel]').length, 5, 'five builder panels');
assert.equal(parsed.window.document.querySelectorAll('[data-step]').length, 5, 'five navigation steps');
for (const id of ['app-name','org-name','site-slug','primary-color','supabase-url','supabase-key','drive-client-id','plan-name','site-preview','generate-btn']) {
  assert.ok(parsed.window.document.getElementById(id), `required control #${id}`);
}
parsed.window.close();

// Every manifest entry must exist and exactly match its SHA-256/byte contract.
assert.equal(manifest.format, 'dramaconnect-generator-template');
assert.equal(manifest.release, '14.1');
assert.equal(manifest.entries.length, manifest.entryCount);
assert.ok(manifest.entryCount >= 100, 'complete template file count');
for (const entry of manifest.entries) {
  assert.ok(!entry.path.startsWith('/') && !entry.path.includes('..'), `safe path ${entry.path}`);
  const data = await fs.readFile(path.join(templateRoot, entry.path));
  assert.equal(data.byteLength, entry.bytes, `size ${entry.path}`);
  assert.equal(digest(data), entry.sha256, `sha256 ${entry.path}`);
}
const templateConfig = await fs.readFile(path.join(templateRoot, 'assets/js/config.js'), 'utf8');
assert.match(templateConfig, /__SUPABASE_URL__/);
assert.match(templateConfig, /__SUPABASE_ANON_KEY__/);
assert.doesNotMatch(templateConfig, /fnhvilfamgadolnrwbpz/);
for (const page of ['settings','admin-data','storage-manager','platform-health','roles-status','site-license']) {
  assert.ok(manifest.entries.some((entry) => entry.path === `pages/${page}.html`), `administration page ${page}`);
}

// Load the actual browser module in JSDOM and use its exported, production
// customization functions to construct an output ZIP.
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://generator.example/' });
dom.window.scrollTo = () => {};
dom.window.fetch = async (url) => {
  const relative = String(url).replace(/^templates\/dramaconnect\//, '');
  const data = await fs.readFile(path.join(templateRoot, decodeURIComponent(relative)));
  return {
    ok: true, status: 200,
    json: async () => JSON.parse(data.toString('utf8')),
    text: async () => data.toString('utf8'),
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  };
};
Object.defineProperty(dom.window, 'crypto', { value: webcrypto });
dom.window.TextDecoder = TextDecoder;
dom.window.TextEncoder = TextEncoder;
dom.window.JSZip = JSZip;
dom.window.eval(source);
dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
await new Promise((resolve) => setTimeout(resolve, 20));
const api = dom.window.DramaConnectGenerator;
assert.ok(api, 'browser API exported');
assert.equal(api.validateSupabaseKey(`sb_publishable_${'a'.repeat(32)}`), '');
assert.match(api.validateSupabaseKey('sb_secret_forbidden'), /forbidden/i);
const servicePayload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
assert.match(api.validateSupabaseKey(`x.${servicePayload}.x`), /anon/i);

const config = {
  appName: 'StageCraft Connect', orgName: 'Grace Theatre Ministry', province: 'Ikeja', shortName: 'StageCraft',
  currency: '₦', slug: 'stagecraft-connect', color: '#1849a9', supabaseUrl: 'https://example-ref.supabase.co',
  supabaseKey: `sb_publishable_${'a'.repeat(32)}`, driveClientId: '123456789-stagecraft.apps.googleusercontent.com',
  licenseModel: 'subscription', planName: 'StageCraft Annual', status: 'active', expiresOn: '2030-12-31',
  graceDays: 21, renewalUrl: 'https://example.org/renew', supportEmail: 'support@example.org',
  registryUrl: 'https://license.example.org/status'
};
api.state.manifest = manifest;
const zip = new JSZip();
const zipRoot = zip.folder(config.slug);
let generatedSql = '';
for (const entry of manifest.entries) {
  const data = await fs.readFile(path.join(templateRoot, entry.path));
  let output = entry.encoding === 'utf8' ? api.customizeText(entry.path, data.toString('utf8'), config) : data;
  if (entry.path === 'database/complete-schema.sql') generatedSql = output;
  zipRoot.file(entry.path, output, { binary: typeof output !== 'string' });
}
zipRoot.file('generated-site.json', JSON.stringify({ format:'dramaconnect-generated-site', templateRelease:'14.1' }));

// --- Brand neutrality: the canonical template must be tokenised, and every token
// --- must be resolved by generation. A generated site may never carry the source
// --- deployment's identity, and may never ship an unresolved sentinel.
{
  const sentinelPattern = /__(DC|SUPABASE)_[A-Z_]+__/;
  const residualBrand = /RCCG LP 25|RCCG LP25|LP 25|DramaConnect Enterprise|rccg lp25|fnhvilfamgadolnrwbpz/i;
  let scanned = 0, sentinelLeaks = [], brandLeaks = [], branded = 0, orgHits = 0;

  for (const entry of manifest.entries) {
    if (entry.encoding !== 'utf8') continue;
    // Template (pre-customisation) must already be free of the source brand.
    const templateText = await fs.readFile(path.join(templateRoot, entry.path), 'utf8');
    if (residualBrand.test(templateText)) brandLeaks.push(`${entry.path} (template)`);

    const output = api.customizeText(entry.path, templateText, config);
    scanned += 1;
    const sentinel = output.match(sentinelPattern);
    if (sentinel) sentinelLeaks.push(`${entry.path}: ${sentinel[0]}`);
    if (residualBrand.test(output)) brandLeaks.push(`${entry.path} (generated)`);
    if (output.includes('Grace Theatre Ministry')) orgHits += 1;
    if (output.includes('StageCraft Connect')) branded += 1;
  }

  assert.ok(scanned > 80, `expected to scan the text template files, scanned ${scanned}`);
  assert.deepEqual(brandLeaks, [], `residual source-brand strings found in:\n  ${brandLeaks.join('\n  ')}`);
  assert.deepEqual(sentinelLeaks, [], `unresolved sentinel tokens found in:\n  ${sentinelLeaks.join('\n  ')}`);
  assert.ok(orgHits > 0, 'organization name should be substituted somewhere in the output');
  assert.ok(branded > 0, 'application name should be substituted somewhere in the output');
}
const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
const loadedZip = await JSZip.loadAsync(zipBytes);
const outputPaths = Object.keys(loadedZip.files);
assert.ok(outputPaths.includes('stagecraft-connect/index.html'));
assert.ok(outputPaths.includes('stagecraft-connect/database/complete-schema.sql'));
assert.ok(outputPaths.includes('stagecraft-connect/pages/site-license.html'));
assert.ok(outputPaths.length >= manifest.entryCount + 1);
const outputConfig = await loadedZip.file('stagecraft-connect/assets/js/config.js').async('string');
assert.match(outputConfig, /https:\/\/example-ref\.supabase\.co/);
assert.match(outputConfig, /StageCraft Connect/);
assert.match(outputConfig, /PROVINCE:\s*'Ikeja'/);
assert.doesNotMatch(outputConfig, /__SUPABASE_/);
assert.match(generatedSql, /Generator seed/);
assert.match(generatedSql, /StageCraft Annual/);
assert.match(generatedSql, /license_model = 'subscription'/);
assert.match(generatedSql, /google_client_id = '123456789-stagecraft\.apps\.googleusercontent\.com'/);

// Execute the customized cumulative output twice in a disposable Supabase-like
// PostgreSQL harness and assert generator-specific seed state.
const db = new PGlite();
const bootstrap = String.raw`
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon') $$;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text NOT NULL, owner uuid, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name,'/') $$;
`;
try {
  await db.exec(bootstrap);
  await db.exec(generatedSql);
  await db.exec(generatedSql);
  const { rows } = await db.query(`SELECT l.license_model,l.plan_name,l.expires_on::text,l.grace_days,l.registry_url,b.google_client_id,t.app_name,t.org_name FROM public.dc_site_license l CROSS JOIN public.dc_backup_settings b CROSS JOIN public.tenant_settings t WHERE l.id=1 AND b.id=1 AND t.id=1`);
  assert.equal(rows[0].license_model, 'subscription');
  assert.equal(rows[0].plan_name, 'StageCraft Annual');
  assert.equal(rows[0].expires_on, '2030-12-31');
  assert.equal(rows[0].grace_days, 21);
  assert.equal(rows[0].registry_url, 'https://license.example.org/status');
  assert.equal(rows[0].google_client_id, config.driveClientId);
  assert.equal(rows[0].app_name, config.appName);
  assert.equal(rows[0].org_name, config.orgName);
} finally {
  await db.close();
  dom.window.close();
}

console.log(`Generator validation: PASS`);
console.log(`Verified ${manifest.entryCount} template files, browser validation/customization, generated ZIP structure and customized schema rerun.`);
