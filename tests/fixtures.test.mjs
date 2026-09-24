#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(root, '..');
const outputDir = process.env.FIXTURE_DIR || path.join(workspace, 'qa-fixtures');
const logoPath = process.env.FIXTURE_LOGO || path.join(outputDir, 'stagelight-brand.png');
const baseUrl = process.env.GENERATOR_URL || 'http://127.0.0.1:4173';
await fs.mkdir(outputDir, { recursive: true });
await fs.access(logoPath);

const fixtures = [
  {
    filename: 'generated-lifetime-fixture.zip', slug: 'stagelight-lifetime', appName: 'StageLight Lifetime',
    orgName: 'Grace Stage Lifetime Ministry', province: 'Lagos Test Chapter', color: '#0b3b75',
    supabaseUrl: 'https://lifetime-fixture.supabase.co', key: `sb_publishable_${'l'.repeat(32)}`,
    drive: '123456789-lifetime.apps.googleusercontent.com', model: 'lifetime', plan: 'Lifetime Ownership',
    status: 'active', expires: '', grace: '14', renewal: '', registry: ''
  },
  {
    filename: 'generated-subscription-fixture.zip', slug: 'stagelight-subscription', appName: 'StageLight Subscription',
    orgName: 'Grace Stage Subscription Ministry', province: 'Abuja Test Chapter', color: '#9a3412',
    supabaseUrl: 'https://subscription-fixture.supabase.co', key: `sb_publishable_${'s'.repeat(32)}`,
    drive: '987654321-subscription.apps.googleusercontent.com', model: 'subscription', plan: 'Annual Resilience',
    status: 'active', expires: '2032-06-30', grace: '28', renewal: 'https://billing.example.test/renew', registry: 'https://license.example.test/status'
  }
];

const browser = await chromium.launch({ headless: true });
try {
  for (const item of fixtures) {
    const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(baseUrl, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200);
    await page.waitForFunction(() => document.getElementById('template-status')?.textContent.includes('canonical files ready'));

    await page.locator('#app-name').fill(item.appName);
    await page.locator('#org-name').fill(item.orgName);
    await page.locator('#province').fill(item.province);
    await page.locator('#short-name').fill('StageLight');
    await page.locator('#site-slug').fill(item.slug);
    await page.locator('#next-btn').click();
    await page.locator('#primary-color-text').fill(item.color);
    await page.locator('#logo-file').setInputFiles(logoPath);
    await page.waitForFunction(() => document.querySelector('#logo-preview img'));
    await page.locator('#next-btn').click();
    await page.locator('#supabase-url').fill(item.supabaseUrl);
    await page.locator('#supabase-key').fill(item.key);
    await page.locator('#drive-client-id').fill(item.drive);
    await page.locator('#next-btn').click();
    if (item.model === 'subscription') await page.getByText('Subscription', { exact: true }).click();
    await page.locator('#plan-name').fill(item.plan);
    await page.locator('#license-status').selectOption(item.status);
    if (item.expires) await page.locator('#expires-on').fill(item.expires);
    await page.locator('#grace-days').fill(item.grace);
    if (item.renewal) await page.locator('#renewal-url').fill(item.renewal);
    await page.locator('#support-email').fill('support@example.test');
    if (item.registry) await page.locator('#registry-url').fill(item.registry);
    await page.locator('#next-btn').click();
    await page.locator('#acknowledge').check();
    await page.locator('#validate-btn').click();
    await page.waitForFunction(() => !document.getElementById('generate-btn').disabled);
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.locator('#generate-btn').click();
    const download = await downloadPromise;
    await download.saveAs(path.join(outputDir, item.filename));
    assert.equal(errors.length, 0, errors.join('\n'));
    await page.close();
  }
} finally {
  await browser.close();
}

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR', 'PNG IHDR');
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

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

const templateLogo = await fs.readFile(path.join(root, 'templates/dramaconnect/assets/img/rccg_logo.png'));
for (const item of fixtures) {
  const archiveBytes = await fs.readFile(path.join(outputDir, item.filename));
  const zip = await JSZip.loadAsync(archiveBytes);
  const filePaths = Object.keys(zip.files).filter(name => !zip.files[name].dir);
  assert.ok(filePaths.length >= 110);
  assert.ok(filePaths.every(name => name.startsWith(`${item.slug}/`)), 'single preserved root folder');
  assert.ok(zip.file(`${item.slug}/database/complete-schema.sql`));
  assert.ok(zip.file(`${item.slug}/pages/settings.html`));
  assert.ok(zip.file(`${item.slug}/pages/admin-data.html`));
  assert.ok(zip.file(`${item.slug}/pages/storage-manager.html`));
  assert.ok(zip.file(`${item.slug}/pages/platform-health.html`));
  assert.ok(zip.file(`${item.slug}/pages/roles-status.html`));
  assert.ok(zip.file(`${item.slug}/pages/site-license.html`));

  const expectedImages = new Map([
    ['assets/img/rccg_logo.png', 1024], ['assets/icons/icon-192.png', 192],
    ['assets/icons/icon-512.png', 512], ['assets/icons/apple-touch-icon.png', 180]
  ]);
  for (const [relative, size] of expectedImages) {
    const bytes = Buffer.from(await zip.file(`${item.slug}/${relative}`).async('uint8array'));
    assert.deepEqual(pngDimensions(bytes), [size, size], `${relative} dimensions`);
    if (relative === 'assets/img/rccg_logo.png') assert.notDeepEqual(bytes, templateLogo, 'custom logo replaces canonical branding');
  }

  const outputConfig = await zip.file(`${item.slug}/assets/js/config.js`).async('string');
  assert.match(outputConfig, new RegExp(item.supabaseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(outputConfig, new RegExp(item.key));
  assert.doesNotMatch(outputConfig, /__SUPABASE_|fnhvilfamgadolnrwbpz|sb_secret_/i);
  const receipt = await zip.file(`${item.slug}/generated-site.json`).async('string');
  const receiptJson = JSON.parse(receipt);
  assert.equal(receiptJson.folder, item.slug);
  assert.equal(receiptJson.licenseModel, item.model);
  assert.equal(receiptJson.productionSql, 'database/complete-schema.sql');
  assert.doesNotMatch(receipt, /supabase\.co|sb_publishable_|apps\.googleusercontent\.com/);
  const sql = await zip.file(`${item.slug}/database/complete-schema.sql`).async('string');
  assert.match(sql, new RegExp(`license_model = '${item.model}'`));
  assert.match(sql, new RegExp(item.drive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const db = new PGlite();
  try {
    await db.exec(bootstrap);
    await db.exec(sql);
    await db.exec(sql);
    const { rows } = await db.query(`SELECT l.license_model,l.plan_name,l.expires_on::text,l.grace_days,b.google_client_id,t.app_name,t.org_name FROM public.dc_site_license l CROSS JOIN public.dc_backup_settings b CROSS JOIN public.tenant_settings t WHERE l.id=1 AND b.id=1 AND t.id=1`);
    assert.equal(rows[0].license_model, item.model);
    assert.equal(rows[0].plan_name, item.plan);
    assert.equal(rows[0].expires_on, item.expires || null);
    assert.equal(rows[0].grace_days, Number(item.grace));
    assert.equal(rows[0].google_client_id, item.drive);
    assert.equal(rows[0].app_name, item.appName);
    assert.equal(rows[0].org_name, item.orgName);
  } finally {
    await db.close();
  }
}

console.log('Lifetime and subscription PNG-branded ZIP fixtures: PASS');
console.log(`Generated, inspected, and schema-reran ${fixtures.length} archives in ${outputDir}.`);
