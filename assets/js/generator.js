(() => {
  'use strict';

  const state = { step: 0, manifest: null, logoFiles: null, logoDataUrl: '', building: false };
  const panels = () => [...document.querySelectorAll('[data-panel]')];
  const stepButtons = () => [...document.querySelectorAll('[data-step]')];
  const $ = (id) => document.getElementById(id);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const textExtensions = new Set(['html','css','js','mjs','json','md','txt','sql','xml','yml','yaml','toml','svg','gs','sh','gitignore','nojekyll']);
  const safeNamePattern = /^[\p{L}\p{N} &.,()/_-]+$/u;

  function clean(value) { return String(value ?? '').trim(); }
  function selectedLicenseModel() { return document.querySelector('input[name="license-model"]:checked')?.value || 'lifetime'; }
  function isHttps(value) {
    if (!value) return true;
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  }
  function isSafeName(value, min = 2) {
    return value.length >= min && safeNamePattern.test(value) && !/[<'"`\\>]/.test(value);
  }
  function decodeJwtPayload(token) {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
      const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
      return JSON.parse(atob(normalized));
    } catch { return null; }
  }
  function validateSupabaseKey(key) {
    if (/^(sb_secret_|service_role)/i.test(key) || /service[_-]?role/i.test(key)) return 'A privileged/service-role key is forbidden.';
    if (/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key)) return '';
    const payload = decodeJwtPayload(key);
    if (!payload) return 'Use a valid sb_publishable_ key or legacy anon JWT.';
    if (payload.role !== 'anon') return `Expected JWT role “anon”, received “${payload.role || 'unknown'}”.`;
    return '';
  }
  function values() {
    return {
      appName: clean($('app-name').value), orgName: clean($('org-name').value), province: clean($('province').value),
      shortName: clean($('short-name').value), currency: clean($('currency').value), slug: clean($('site-slug').value),
      color: clean($('primary-color-text').value).toLowerCase(), supabaseUrl: clean($('supabase-url').value),
      supabaseKey: clean($('supabase-key').value), driveClientId: clean($('drive-client-id').value),
      licenseModel: selectedLicenseModel(), planName: clean($('plan-name').value), status: $('license-status').value,
      expiresOn: $('expires-on').value, graceDays: Number($('grace-days').value), renewalUrl: clean($('renewal-url').value),
      supportEmail: clean($('support-email').value), registryUrl: clean($('registry-url').value)
    };
  }

  function validateConfig(config = values(), requireAcknowledgement = true) {
    const errors = {};
    if (!isSafeName(config.appName)) errors['app-name'] = 'Use 2–64 plain name characters; quotes, angle brackets and backslashes are not allowed.';
    if (!isSafeName(config.orgName)) errors['org-name'] = 'Use a plain organization name without quotes, angle brackets or backslashes.';
    if (config.province && !isSafeName(config.province, 1)) errors.province = 'Use plain chapter/province text.';
    if (!isSafeName(config.shortName)) errors['short-name'] = 'Use a short plain-text app name.';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(config.slug)) errors['site-slug'] = 'Use lowercase letters/digits separated by single hyphens.';
    if (!config.currency || config.currency.length > 4 || /['"`\\<>]/.test(config.currency)) errors.currency = 'Use a safe currency symbol (maximum four characters).';
    if (!/^#[0-9a-f]{6}$/i.test(config.color)) errors['primary-color-text'] = 'Use a six-digit hexadecimal colour.';
    try {
      const url = new URL(config.supabaseUrl);
      if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname) || (url.pathname !== '/' && url.pathname !== '')) throw new Error();
    } catch { errors['supabase-url'] = 'Use the HTTPS origin of a hosted supabase.co project.'; }
    const keyError = validateSupabaseKey(config.supabaseKey);
    if (keyError) errors['supabase-key'] = keyError;
    if (config.driveClientId && !/^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(config.driveClientId)) errors['drive-client-id'] = 'Use a Google OAuth Web client ID ending in .apps.googleusercontent.com.';
    if (!isSafeName(config.planName)) errors['plan-name'] = 'Use a plain-text plan name.';
    if (!['active','past_due','suspended','expired'].includes(config.status)) errors['license-status'] = 'Choose a supported initial status.';
    if (config.licenseModel === 'subscription' && !/^\d{4}-\d{2}-\d{2}$/.test(config.expiresOn)) errors['expires-on'] = 'Choose an expiry date for a subscription.';
    if (!Number.isInteger(config.graceDays) || config.graceDays < 0 || config.graceDays > 90) errors['grace-days'] = 'Grace must be 0–90 days.';
    if (config.renewalUrl && !isHttps(config.renewalUrl)) errors['renewal-url'] = 'Renewal links must use HTTPS.';
    if (config.registryUrl && !isHttps(config.registryUrl)) errors['registry-url'] = 'Registry links must use HTTPS.';
    if (config.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.supportEmail)) errors['support-email'] = 'Use a valid support email address.';
    if (!state.manifest) errors.template = 'The canonical template manifest is not ready.';
    if (requireAcknowledgement && !$('acknowledge').checked) errors.acknowledge = 'Confirm the security and licensing acknowledgement.';
    return errors;
  }

  function validateStep(index) {
    const config = values();
    const all = validateConfig(config, false);
    const stepIds = [
      ['app-name','org-name','province','short-name','currency','site-slug'],
      ['primary-color-text'],
      ['supabase-url','supabase-key','drive-client-id'],
      ['plan-name','license-status','expires-on','grace-days','renewal-url','support-email','registry-url']
    ];
    if (index >= stepIds.length) return all;
    return Object.fromEntries(Object.entries(all).filter(([id]) => stepIds[index].includes(id)));
  }

  function showErrors(errors) {
    document.querySelectorAll('.invalid').forEach((node) => { node.classList.remove('invalid'); node.removeAttribute('aria-invalid'); });
    for (const id of Object.keys(errors)) {
      const node = $(id);
      if (node) { node.classList.add('invalid'); node.setAttribute('aria-invalid', 'true'); }
    }
    const messages = Object.values(errors);
    $('validation-summary').className = `validation-summary ${messages.length ? 'error' : 'success'}`;
    $('validation-summary').textContent = messages.length ? messages.join(' ') : 'Configuration valid. The template is ready for local integrity verification and ZIP assembly.';
    return messages.length === 0;
  }

  function setStep(next) {
    state.step = Math.max(0, Math.min(panels().length - 1, next));
    panels().forEach((panel, index) => panel.classList.toggle('active', index === state.step));
    stepButtons().forEach((button, index) => {
      button.classList.toggle('active', index === state.step);
      button.classList.toggle('complete', index < state.step);
      button.setAttribute('aria-current', index === state.step ? 'step' : 'false');
    });
    $('back-btn').disabled = state.step === 0;
    $('next-btn').hidden = state.step === panels().length - 1;
    $('step-count').textContent = `${state.step + 1} / ${panels().length}`;
    if (state.step === panels().length - 1) renderPreview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  }
  function renderPreview() {
    const c = values();
    const logo = state.logoDataUrl ? `<img src="${state.logoDataUrl}" alt="">` : escapeHtml(c.shortName.slice(0, 2).toUpperCase() || 'DC');
    $('site-preview').srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font-family:system-ui;background:#f3f6fb;color:#17233b}.app{display:grid;grid-template-columns:145px 1fr;min-height:100vh}.side{background:#0c1730;color:white;padding:18px 12px}.logo{width:42px;height:42px;border-radius:13px;background:white;color:${c.color};display:grid;place-items:center;font-weight:900;overflow:hidden}.logo img{width:100%;height:100%;object-fit:contain}.name{font-size:11px;font-weight:800;margin:10px 0 20px}.nav{font-size:8px;color:#91a2c0;padding:8px;border-radius:7px;margin:4px 0}.nav.on{background:${c.color};color:white}.main{padding:23px}.top{display:flex;justify-content:space-between;align-items:center}.top h1{font-size:19px;margin:0}.top p{font-size:8px;color:#7a879b}.pill{background:#dcf8ec;color:#087b57;border-radius:20px;padding:6px 9px;font-size:7px;font-weight:800}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0}.card{background:white;border:1px solid #e0e6ef;border-radius:12px;padding:13px}.card b{display:block;font-size:16px;color:${c.color}}.card span{font-size:7px;color:#748196}.wide{background:white;border:1px solid #e0e6ef;border-radius:12px;padding:15px}.wide h2{font-size:11px;margin:0 0 12px}.row{height:24px;border-top:1px solid #eef1f5;display:flex;align-items:center;justify-content:space-between;font-size:7px;color:#718096}.tag{color:${c.color};font-weight:800}@media(max-width:430px){.app{grid-template-columns:1fr}.side{display:none}}</style></head><body><div class="app"><aside class="side"><div class="logo">${logo}</div><div class="name">${escapeHtml(c.shortName)}</div>${['Dashboard','Members','Productions','Events','Administration'].map((x,i)=>`<div class="nav ${i===0?'on':''}">${x}</div>`).join('')}</aside><main class="main"><div class="top"><div><h1>${escapeHtml(c.appName)}</h1><p>${escapeHtml(c.orgName)} · ${escapeHtml(c.province)}</p></div><span class="pill">${escapeHtml(c.licenseModel === 'lifetime' ? 'Lifetime active' : `${c.status} subscription`)}</span></div><div class="cards"><div class="card"><b>128</b><span>Approved members</span></div><div class="card"><b>12</b><span>Active productions</span></div><div class="card"><b>Healthy</b><span>Platform status</span></div></div><div class="wide"><h2>Administration control plane</h2>${['Verified backup completed','External heartbeat received','Storage quota within threshold','License state evaluated'].map((x,i)=>`<div class="row"><span>${x}</span><span class="tag">${i?'Ready':'Today'}</span></div>`).join('')}</div></main></div></body></html>`;
  }

  function updateBrandPreview() {
    const c = values();
    document.documentElement.style.setProperty('--brand', /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#003399');
    $('brand-name-preview').textContent = c.appName || 'Application name';
    $('brand-org-preview').textContent = c.orgName || 'Organization';
    if (!state.logoDataUrl) $('logo-preview').textContent = (c.shortName || 'DC').slice(0, 2).toUpperCase();
  }

  async function imageToPng(file, size) {
    let bitmap;
    if ('createImageBitmap' in window) bitmap = await createImageBitmap(file);
    else {
      bitmap = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image); image.onerror = reject; image.src = URL.createObjectURL(file);
      });
    }
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, size, size);
    const scale = Math.min(size / bitmap.width, size / bitmap.height);
    const width = bitmap.width * scale, height = bitmap.height * scale;
    context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
    if (bitmap.close) bitmap.close();
    return await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? blob.arrayBuffer().then(resolve, reject) : reject(new Error('Could not convert logo.')), 'image/png'));
  }
  async function processLogo(file) {
    if (!file) { state.logoFiles = null; state.logoDataUrl = ''; $('logo-preview').replaceChildren(document.createTextNode(values().shortName.slice(0,2).toUpperCase())); return; }
    if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
    if (file.size > 2 * 1024 * 1024) throw new Error('Logo must be 2 MiB or smaller.');
    const [main, icon192, icon512, apple] = await Promise.all([imageToPng(file,1024), imageToPng(file,192), imageToPng(file,512), imageToPng(file,180)]);
    state.logoFiles = {
      'assets/img/rccg_logo.png': main,
      'assets/icons/icon-192.png': icon192,
      'assets/icons/icon-512.png': icon512,
      'assets/icons/apple-touch-icon.png': apple
    };
    state.logoDataUrl = URL.createObjectURL(new Blob([main], { type:'image/png' }));
    const image = document.createElement('img'); image.src = state.logoDataUrl; image.alt = 'Selected logo';
    $('logo-preview').replaceChildren(image);
  }

  function sqlLiteral(value) { return `'${String(value).replace(/'/g, "''")}'`; }
  function sqlNullable(value) { return value ? sqlLiteral(value) : 'NULL'; }
  function generationSeedSql(c) {
    const expiry = c.licenseModel === 'subscription' ? `${sqlLiteral(c.expiresOn)}::date` : 'NULL';
    const message = c.licenseModel === 'lifetime'
      ? `Lifetime ownership is active for this ${c.appName} deployment.`
      : `Subscription access is ${c.status.replace('_',' ')} and subject to the configured expiry and grace period.`;
    return `\n\n-- --------------------------------------------------------------------------\n-- Generator seed: applied only until an administrator changes these records.\n-- Browser-hosted entitlement state is operational access control, not a\n-- tamper-proof commercial license authority. Use registry_url for a trusted\n-- external authority when stronger subscription enforcement is required.\n-- --------------------------------------------------------------------------\nBEGIN;\nUPDATE public.dc_site_license\nSET license_model = ${sqlLiteral(c.licenseModel)},\n    plan_name = ${sqlLiteral(c.planName)},\n    license_status = ${sqlLiteral(c.status)},\n    licensed_to = ${sqlLiteral(c.orgName)},\n    expires_on = ${expiry},\n    grace_days = ${c.graceDays},\n    renewal_url = ${sqlNullable(c.renewalUrl)},\n    support_email = ${sqlNullable(c.supportEmail)},\n    public_message = ${sqlLiteral(message)},\n    registry_url = ${sqlNullable(c.registryUrl)}\nWHERE id = 1 AND updated_by IS NULL;\nUPDATE public.dc_backup_settings\nSET google_client_id = ${sqlNullable(c.driveClientId)}\nWHERE id = 1 AND updated_by IS NULL\n  AND (google_client_id IS NULL OR google_client_id = '');\nCOMMIT;\n`;
  }

  function replaceAllLiteral(text, from, to) { return text.split(from).join(to); }

  /**
   * Resolve every sentinel token to the operator's value.
   *
   * The canonical template is brand-neutral: the build step replaced each
   * deployment-specific literal with a token, and this is the single place where
   * tokens become real values. Substituting explicit tokens (rather than
   * searching for the previous deployment's literal text) means a value can
   * never be partially rewritten, and the template never has to carry another
   * organisation's identity.
   */
  function sentinelMap(c) {
    return {
      __SUPABASE_URL__: c.supabaseUrl,
      __SUPABASE_ANON_KEY__: c.supabaseKey,
      __DC_APP_NAME__: c.appName,
      __DC_ORG_NAME__: c.orgName,
      __DC_PROVINCE__: c.province || c.orgName,
      __DC_CURRENCY__: c.currency,
      __DC_PRIMARY_COLOR__: c.color,
      __DC_KEYWORDS__: [
        'theatre management software', 'drama department software', 'acting platform',
        'church drama app', 'cast management', 'backstage inventory', 'drama connect',
        c.orgName, c.appName
      ].filter(Boolean).join(', ')
    };
  }

  function customizeText(path, text, c) {
    let output = text;
    for (const [token, value] of Object.entries(sentinelMap(c))) {
      output = replaceAllLiteral(output, token, String(value ?? ''));
    }
    if (path === 'manifest.json') {
      const manifest = JSON.parse(output);
      manifest.name = `${c.appName} — ${c.orgName}`;
      manifest.short_name = c.shortName;
      manifest.description = `${c.appName}, the management and resilience hub for ${c.orgName}.`;
      manifest.theme_color = c.color;
      output = `${JSON.stringify(manifest, null, 2)}\n`;
    }
    if (path === 'database/complete-schema.sql') output += generationSeedSql(c);
    return output;
  }

  async function sha256Hex(data) {
    const bytes = typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2,'0')).join('');
  }
  function templateUrl(path) { return `templates/dramaconnect/${path.split('/').map(encodeURIComponent).join('/')}`; }
  function isTextEntry(entry) {
    if (entry.encoding === 'utf8') return true;
    const name = entry.path.split('/').pop();
    const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : name;
    return textExtensions.has(extension);
  }
  async function fetchVerifiedEntry(entry) {
    const response = await fetch(templateUrl(entry.path), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Template file unavailable (${response.status}): ${entry.path}`);
    const data = await response.arrayBuffer();
    if (data.byteLength !== entry.bytes) throw new Error(`Template size mismatch: ${entry.path}`);
    const digest = await sha256Hex(data);
    if (digest !== entry.sha256) throw new Error(`Template integrity mismatch: ${entry.path}`);
    return data;
  }

  function progress(done, total, message) {
    $('build-progress').hidden = false;
    $('progress-bar').style.width = `${Math.round(done / total * 100)}%`;
    $('build-status').textContent = message;
  }
  function generationReceipt(c, templateDigest) {
    return `${JSON.stringify({
      format: 'dramaconnect-generated-site', formatVersion: 1, generatedAt: new Date().toISOString(),
      generator: 'DramaConnect Deployment Generator 1.0', template: state.manifest.template || 'DramaConnect', templateRelease: state.manifest.release,
      templateManifestSha256: templateDigest, applicationName: c.appName, organization: c.orgName,
      folder: c.slug, licenseModel: c.licenseModel, archiveSchema: '14.0', productionSql: 'database/complete-schema.sql',
      notices: [
        'Supabase anon/publishable keys are public identifiers constrained by Row Level Security.',
        'No service-role key, database password or OAuth client secret is required by the static app.',
        'Client-hosted licensing is operational access control and is not tamper-proof.',
        'Portable archives do not include Auth credentials or Storage bytes; configure encrypted off-site recovery.'
      ]
    }, null, 2)}\n`;
  }

  async function generateZip() {
    const c = values();
    const errors = validateConfig(c, true);
    if (!showErrors(errors)) return;
    if (state.building) return;
    if (!window.JSZip) { showErrors({ zip: 'The local JSZip library did not load.' }); return; }
    state.building = true; $('generate-btn').disabled = true; $('validate-btn').disabled = true;
    try {
      const zip = new JSZip();
      const root = zip.folder(c.slug);
      const total = state.manifest.entries.length + 2;
      let done = 0;
      for (const entry of state.manifest.entries) {
        progress(done, total, `Verifying ${entry.path}`);
        let data = await fetchVerifiedEntry(entry);
        if (isTextEntry(entry)) data = customizeText(entry.path, decoder.decode(data), c);
        if (state.logoFiles?.[entry.path]) data = state.logoFiles[entry.path];
        root.file(entry.path, data, { binary: typeof data !== 'string' });
        done += 1;
      }
      const manifestResponse = await fetch(templateUrl('_template-manifest.json'), { cache:'no-store' });
      const manifestText = await manifestResponse.text();
      const templateDigest = await sha256Hex(manifestText);
      root.file('generated-site.json', generationReceipt(c, templateDigest));
      root.file('START_HERE.txt', `DRAMACONNECT GENERATED DEPLOYMENT\n\n1. In Supabase SQL Editor run ALL of database/complete-schema.sql.\n2. Deploy this folder's contents so index.html is at the site root.\n3. Sign up the first account and deliberately promote that exact email using docs/DEPLOYMENT.md.\n4. Configure and test external heartbeats, Google Drive, and encrypted off-site recovery.\n5. Never place a service-role key, database password or OAuth client secret in this static site.\n`);
      done += 1; progress(done, total, 'Compressing deployable ZIP…');
      const blob = await zip.generateAsync({ type:'blob', compression:'DEFLATE', compressionOptions:{ level:6 }, streamFiles:true }, (metadata) => {
        $('progress-bar').style.width = `${Math.min(99, Math.round((done / total) * 100 + metadata.percent / total))}%`;
      });
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${c.slug}-v14.0.zip`; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      progress(total, total, `Generated ${anchor.download} (${(blob.size / 1024 / 1024).toFixed(2)} MiB).`);
      $('validation-summary').className = 'validation-summary success';
      $('validation-summary').textContent = 'ZIP generated. Keep the generation receipt, run only the cumulative SQL, and complete the deployment checklist.';
    } catch (error) {
      console.error(error);
      showErrors({ build: error.message || String(error) });
      $('build-status').textContent = 'Build stopped without producing a partial download.';
    } finally {
      state.building = false; $('validate-btn').disabled = false; $('generate-btn').disabled = !$('acknowledge').checked;
    }
  }

  async function loadManifest() {
    try {
      const response = await fetch(templateUrl('_template-manifest.json'), { cache:'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = await response.json();
      if (manifest.format !== 'dramaconnect-generator-template' || manifest.release !== '14.0' || manifest.entryCount !== manifest.entries?.length) throw new Error('Unsupported template manifest.');
      if (!manifest.entries.every((entry) => /^[a-zA-Z0-9._/-]+$/.test(entry.path) && !entry.path.includes('..') && /^[a-f0-9]{64}$/.test(entry.sha256))) throw new Error('Unsafe template manifest entry.');
      state.manifest = manifest;
      document.querySelector('.status-dot').classList.add('ready');
      $('template-status').textContent = `${manifest.entryCount} canonical files ready · ${(manifest.totalBytes/1024/1024).toFixed(2)} MiB · SHA-256 verified during build`;
    } catch (error) {
      document.querySelector('.status-dot').classList.add('error');
      $('template-status').textContent = `Template unavailable: ${error.message}. Serve this generator over HTTP(S).`;
      $('validation-summary').className = 'validation-summary error';
      $('validation-summary').textContent = 'The template manifest could not be loaded. Do not generate from an incomplete source.';
    }
  }

  function bind() {
    $('next-btn').addEventListener('click', () => {
      const errors = validateStep(state.step);
      if (Object.keys(errors).length) { showErrors(errors); document.querySelector('.panel.active').classList.add('shake'); setTimeout(()=>document.querySelector('.panel.active')?.classList.remove('shake'),300); return; }
      setStep(state.step + 1);
    });
    $('back-btn').addEventListener('click', () => setStep(state.step - 1));
    stepButtons().forEach((button) => button.addEventListener('click', () => {
      const target = Number(button.dataset.step);
      if (target <= state.step || Object.keys(validateStep(state.step)).length === 0) setStep(target);
    }));
    $('primary-color').addEventListener('input', () => { $('primary-color-text').value = $('primary-color').value; updateBrandPreview(); });
    $('primary-color-text').addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test($('primary-color-text').value)) $('primary-color').value = $('primary-color-text').value; updateBrandPreview(); });
    ['app-name','org-name','short-name'].forEach((id) => $(id).addEventListener('input', updateBrandPreview));
    $('logo-file').addEventListener('change', async () => { try { await processLogo($('logo-file').files[0]); } catch(error) { $('logo-file').value=''; showErrors({'logo-file':error.message}); } });
    document.querySelectorAll('input[name="license-model"]').forEach((input) => input.addEventListener('change', () => {
      const subscription = selectedLicenseModel() === 'subscription';
      document.querySelectorAll('.subscription-only').forEach((node) => { node.hidden = !subscription; });
      if (subscription && $('plan-name').value === 'DramaConnect Lifetime') $('plan-name').value = 'DramaConnect Subscription';
      if (!subscription && $('plan-name').value === 'DramaConnect Subscription') $('plan-name').value = 'DramaConnect Lifetime';
    }));
    $('validate-btn').addEventListener('click', () => { const ok = showErrors(validateConfig(values(), true)); $('generate-btn').disabled = !ok; if (ok) renderPreview(); });
    $('acknowledge').addEventListener('change', () => { $('generate-btn').disabled = !showErrors(validateConfig(values(), true)); });
    $('generate-btn').addEventListener('click', generateZip);
    document.querySelectorAll('input,textarea,select').forEach((node) => node.addEventListener('input', () => { node.classList.remove('invalid'); node.removeAttribute('aria-invalid'); $('generate-btn').disabled = true; }));
    window.addEventListener('beforeunload', (event) => { if (state.building) { event.preventDefault(); event.returnValue = ''; } });
    updateBrandPreview(); renderPreview();
  }

  window.DramaConnectGenerator = { validateSupabaseKey, validateConfig, customizeText, generationSeedSql, sha256Hex, state };
  document.addEventListener('DOMContentLoaded', () => { bind(); loadManifest(); });
})();
