#!/usr/bin/env node
/**
 * Publishes the gestionale on YOUR Cloudflare account (alternative to Sites).
 * Guide: docs/CLOUDFLARE.md. Nothing here changes .openai/hosting.json or the Sites setup.
 *
 *   node scripts/cloudflare-deploy.mjs --check     build + generated config + wrangler dry run (no account needed)
 *   node scripts/cloudflare-deploy.mjs             build + remote D1 migrations + deploy
 *
 * Required environment (GitHub Actions variables/secrets or a local shell, never in Git):
 *   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID     (secrets; wrangler reads them; not needed for --check)
 *   CF_D1_DATABASE_ID, CF_D1_DATABASE_NAME         (the D1 database created in the dashboard)
 *   CF_CUSTOM_DOMAIN                               (e.g. gestionale.esempio.it, a zone on the same account)
 *   ACCESS_TEAM_DOMAIN, ACCESS_AUD                 (Cloudflare Access team domain and application AUD tag)
 * Optional: CF_WORKER_NAME (default prima-colazione-stabilimento).
 *
 * Safety: the deploy is refused if Access is not configured; the workers.dev address and
 * preview URLs are disabled, so the only entrance is the custom domain behind Access.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const check = process.argv.includes('--check');
const env = process.env;
const required = ['CF_D1_DATABASE_ID', 'CF_D1_DATABASE_NAME', 'CF_CUSTOM_DOMAIN', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', ...(check ? [] : ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'])];
const missing = required.filter(name => !env[name]?.trim());
if (missing.length) {
  console.error(`Pubblicazione rifiutata: mancano ${missing.join(', ')}. Vedi docs/CLOUDFLARE.md.`);
  process.exit(2);
}
const domain = env.CF_CUSTOM_DOMAIN.trim().toLowerCase();
const team = env.ACCESS_TEAM_DOMAIN.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) { console.error('CF_CUSTOM_DOMAIN non valido (solo il nome, es. gestionale.esempio.it).'); process.exit(2); }
if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)) { console.error('ACCESS_TEAM_DOMAIN non valido (es. nome-team.cloudflareaccess.com).'); process.exit(2); }
if (!/^[a-f0-9-]{36}$/i.test(env.CF_D1_DATABASE_ID.trim())) { console.error('CF_D1_DATABASE_ID non valido (identificativo del database D1).'); process.exit(2); }

const run = (args, label) => {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env });
  if (result.status !== 0) { console.error(`Interrotto: ${label} non riuscito.`); process.exit(result.status || 1); }
};
const wrangler = ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js'];

run(['scripts/run-framework.mjs', 'build'], 'Compilazione');
const generated = JSON.parse(readFileSync('dist/server/wrangler.json', 'utf8'));
const config = {
  ...generated,
  name: env.CF_WORKER_NAME?.trim() || 'prima-colazione-stabilimento',
  workers_dev: false,
  preview_urls: false,
  routes: [{ pattern: domain, custom_domain: true }],
  d1_databases: [{ binding: 'DB', database_name: env.CF_D1_DATABASE_NAME.trim(), database_id: env.CF_D1_DATABASE_ID.trim(), migrations_dir: resolve('drizzle') }],
  vars: { ...(generated.vars ?? {}), AUTH_MODE: 'cloudflare-access', ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: env.ACCESS_AUD.trim() },
};
delete config.topLevelName;
// Same folder as the generated config: wrangler resolves `main` and assets relative to it.
const file = resolve('dist/server/cloudflare.wrangler.json');
writeFileSync(file, JSON.stringify(config, null, 2));
console.log(`Configurazione Cloudflare: ${file} (dominio ${domain}, Access ${team}, workers.dev disattivato)`);

if (check) {
  run([...wrangler, 'deploy', '--config', file, '--dry-run'], 'Prova di pubblicazione (nessun invio)');
  console.log('\nVerifica completata: nulla è stato pubblicato.');
} else {
  run([...wrangler, 'd1', 'migrations', 'apply', config.d1_databases[0].database_name, '--remote', '--config', file], 'Migrazioni del database (solo quelle mancanti)');
  run([...wrangler, 'deploy', '--config', file], 'Pubblicazione del Worker');
  console.log(`\nPubblicato. Controlla https://${domain}: senza accesso Cloudflare deve chiedere il login.`);
}
