# DramaConnect Deployment Generator

A standalone browser generator for branded DramaConnect v14 deployment ZIPs. It uses the validated DramaConnect application release as a canonical, brand-neutral template and preserves its directory structure under a configurable ZIP root.

## Run it

The template is fetched as same-origin files, so serve the generator over HTTP(S)—do not double-click `index.html` as a `file://` URL.

```bash
cd dramaconnect-generator
python3 -m http.server 4173 --bind 0.0.0.0
```

Open `http://localhost:4173`, complete all five steps, validate, and select **Generate deployable ZIP**. No backend is required and no configuration is uploaded.

## What it configures

- application, organization, province/chapter, short name and ZIP folder;
- primary colour and an optional locally converted PNG logo/icon set;
- Supabase project URL and browser-safe anon/publishable key;
- optional Google OAuth **Web client ID** (never a client secret);
- lifetime or subscription license display/enforcement state;
- subscription expiry, grace, renewal/support links and optional external registry;
- cumulative SQL seed state for branding, Drive and licensing.

The output retains all 37 app pages, six dedicated administration workspaces, 25-table sealed portability, verified Drive upload/download checks, backup leases/history/retention, private vault, unattended encrypted recovery tooling, independent free-tier activity paths and `database/complete-schema.sql`.

## Integrity and output behavior

1. `templates/dramaconnect/_template-manifest.json` lists every canonical source path, byte count, SHA-256 digest and the full sentinel vocabulary.
2. At build time the browser fetches and verifies every file before customization.
3. Unsafe paths, missing files, size mismatches and hash mismatches stop generation without a partial download.
4. Customization replaces declared sentinel tokens only; the template carries no other deployment's branding, and service-role/secret keys are rejected.
5. The generated ZIP includes `generated-site.json` and `START_HERE.txt` inside the chosen root.
6. Logo processing stays in-browser and writes PNG bytes to the existing image/icon paths.

## Generated-site database setup

Run **all of `database/complete-schema.sql`** in Supabase SQL Editor. It is cumulative and idempotent; no individual SQL is required afterward. The generator seed applies while the singleton settings rows have not been changed by an administrator, so later operator edits are preserved on reruns.

Sign up the first account and deliberately promote that exact email using the generated `docs/DEPLOYMENT.md`. The schema never makes the first visitor an administrator and never blanket-approves pending users.

## Security boundaries

- The Supabase anon/publishable key is public by design; RLS and server-authoritative RPCs provide authorization.
- The generator rejects `sb_secret_*`, service-role JWTs and non-anon legacy JWTs.
- Never place a database password, Supabase personal access token, service-role key, backup passphrase, cron secret or OAuth client secret in generated static files.
- Google Drive browser authorization uses `drive.file`, a memory-only access token, explicit reconnect, dedicated folder discovery, upload/download verification, leases and retention after successful verification.
- Portable JSON does not contain Auth passwords/sessions or Storage bytes. Configure the generated encrypted off-site database/Auth/Storage workflow and rehearse recovery.
- Client-hosted subscription licensing is operational access control, not tamper-proof commercial enforcement. Configure a trusted external registry if stronger entitlement authority is required.

## Refresh the canonical template

After the DramaConnect application changes and passes its tests:

```bash
npm run build:template
npm test
```

The builder copies production/source/operator files from the validated DramaConnect application, removes repository/dev-only artifacts, and rewrites every deployment-specific literal into a sentinel token (`__DC_APP_NAME__`, `__DC_ORG_NAME__`, `__DC_PROVINCE__`, `__DC_CURRENCY__`, `__DC_PRIMARY_COLOR__`, `__DC_KEYWORDS__`, `__SUPABASE_URL__`, `__SUPABASE_ANON_KEY__`). The build **fails** if any residual brand string survives, so a stale identity can never reach a customer.

Point the builder at your application source in any of these ways:

```bash
npm run build:template -- --source ../my-dramaconnect-app
DRAMACONNECT_SOURCE=../my-dramaconnect-app npm run build:template
npm run build:template          # auto-discovers a single sibling DramaConnect app
```

Never hand-edit copied template files; change the source application, rebuild, and test.

## Tests

Install the pinned development dependencies and run the core integration suite:

```bash
npm ci
npm test
```

It verifies:

- HTML controls and JavaScript via esbuild;
- every template file's path, byte count and SHA-256;
- credential sanitization and required administration pages;
- publishable-key validation and secret-key rejection;
- actual browser customization functions;
- generated ZIP root/folder structure and patched config;
- customized `complete-schema.sql` execution twice in a disposable Supabase-compatible PostgreSQL harness;
- generated branding, Drive and subscription seed state.

For real Chromium navigation/download checks and explicit lifetime/subscription PNG-branded fixtures:

```bash
npx playwright install chromium
npm run test:browser
npm run test:fixtures
```

The fixture suite saves its QA archives outside the generator tree by default (`../qa-fixtures`), verifies the four generated PNG dimensions, inspects sanitized configuration and receipts, and executes both generated cumulative schemas twice.
