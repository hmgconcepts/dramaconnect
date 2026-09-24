#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import JSZip from 'jszip';

const baseUrl = process.env.GENERATOR_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
try {
  const response = await page.goto(baseUrl, { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200);
  await page.waitForFunction(() => document.getElementById('template-status')?.textContent.includes('canonical files ready'));
  assert.match(await page.locator('#template-status').textContent(), /109 canonical files ready/);

  await page.locator('#next-btn').click();
  assert.equal(await page.locator('[data-panel="1"]').isVisible(), true);
  await page.locator('#primary-color-text').fill('#1849a9');
  await page.locator('#next-btn').click();
  assert.equal(await page.locator('[data-panel="2"]').isVisible(), true);
  await page.locator('#supabase-url').fill('https://browser-test.supabase.co');
  await page.locator('#supabase-key').fill(`sb_publishable_${'b'.repeat(32)}`);
  await page.locator('#drive-client-id').fill('123456789-browser.apps.googleusercontent.com');
  await page.locator('#next-btn').click();
  assert.equal(await page.locator('[data-panel="3"]').isVisible(), true);
  await page.getByText('Subscription', { exact: true }).click();
  await page.locator('#expires-on').fill('2031-12-31');
  await page.locator('#plan-name').fill('Browser Test Annual');
  await page.locator('#next-btn').click();
  assert.equal(await page.locator('[data-panel="4"]').isVisible(), true);
  await page.locator('#acknowledge').check();
  await page.locator('#validate-btn').click();
  await page.waitForFunction(() => !document.getElementById('generate-btn').disabled);
  assert.match(await page.locator('#validation-summary').textContent(), /Configuration valid/);
  const previewText = await page.locator('#site-preview').contentFrame().locator('body').textContent();
  assert.match(previewText, /DramaConnect Enterprise/);
  assert.match(previewText, /subscription/i);

  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
  await page.locator('#generate-btn').click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'dramaconnect-v14.0.zip');
  const downloadPath = await download.path();
  const bytes = await fs.readFile(downloadPath);
  const zip = await JSZip.loadAsync(bytes);
  assert.ok(zip.file('dramaconnect/index.html'));
  assert.ok(zip.file('dramaconnect/database/complete-schema.sql'));
  assert.ok(zip.file('dramaconnect/pages/site-license.html'));
  assert.ok(zip.file('dramaconnect/generated-site.json'));
  const config = await zip.file('dramaconnect/assets/js/config.js').async('string');
  assert.match(config, /browser-test\.supabase\.co/);
  assert.doesNotMatch(config, /__SUPABASE_/);
  const sql = await zip.file('dramaconnect/database/complete-schema.sql').async('string');
  assert.match(sql, /Browser Test Annual/);
  assert.match(sql, /license_model = 'subscription'/);
  await page.waitForFunction(() => document.getElementById('build-status')?.textContent.includes('Generated'));
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Playwright browser generation: PASS');
  console.log(`Downloaded and inspected ${download.suggestedFilename()} (${bytes.byteLength} bytes).`);
} finally {
  await browser.close();
}
