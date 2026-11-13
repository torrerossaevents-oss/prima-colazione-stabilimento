/**
 * Cloudflare Access mode: every request must carry a valid RS256 JWT signed by the
 * team's keys, for the right audience, not expired. Keys are generated here and served
 * by a stubbed fetch: no network, no real Cloudflare account.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerOf, resetAccessKeyCache, verifyAccessJwt } from '../lib/server/auth.ts';
import { loadRoute, setEnv, sqliteDb } from './helpers/d1.ts';

const team = 'prova-team.cloudflareaccess.com';
const aud = 'aud-tag-di-prova-0123456789abcdef';
const b64url = (data: Uint8Array | string) => Buffer.from(data).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

async function keyPair(kid: string) {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid };
  return { pair, jwk };
}
async function sign(privateKey: CryptoKey, kid: string, claims: Record<string, unknown>) {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}
function serveKeys(keys: JsonWebKey[]) {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `https://${team}/cdn-cgi/access/certs`) { calls++; return Response.json({ keys }); }
    return original(input);
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; }, calls: () => calls };
}
const now = () => Math.floor(Date.now() / 1000);
const claims = (extra: Record<string, unknown> = {}) => ({ iss: `https://${team}`, aud: [aud], sub: 'utente-1', email: 'Titolare@Esempio.it', exp: now() + 600, iat: now(), ...extra });

test('Access JWT: valid token accepted; tampered, expired, wrong audience or issuer refused', async () => {
  resetAccessKeyCache();
  const { pair, jwk } = await keyPair('k1');
  const other = await keyPair('k1');
  const keys = serveKeys([jwk]);
  try {
    const ok = await verifyAccessJwt(await sign(pair.privateKey, 'k1', claims()), { teamDomain: team, aud });
    assert.deepEqual(ok, { sub: 'utente-1', email: 'Titolare@Esempio.it' });
    assert.equal(await verifyAccessJwt(await sign(other.pair.privateKey, 'k1', claims()), { teamDomain: team, aud }), null, 'signed by another key');
    const token = await sign(pair.privateKey, 'k1', claims());
    const [h, , s] = token.split('.');
    assert.equal(await verifyAccessJwt(`${h}.${b64url(JSON.stringify(claims({ email: 'intruso@esempio.it' })))}.${s}`, { teamDomain: team, aud }), null, 'payload changed after signing');
    assert.equal(await verifyAccessJwt(await sign(pair.privateKey, 'k1', claims({ exp: now() - 120 })), { teamDomain: team, aud }), null, 'expired');
    assert.equal(await verifyAccessJwt(await sign(pair.privateKey, 'k1', claims({ aud: ['altra-app'] })), { teamDomain: team, aud }), null, 'wrong audience');
    assert.equal(await verifyAccessJwt(await sign(pair.privateKey, 'k1', claims({ iss: 'https://altro.cloudflareaccess.com' })), { teamDomain: team, aud }), null, 'wrong issuer');
    assert.equal(await verifyAccessJwt('non.un.token', { teamDomain: team, aud }), null);
    assert.equal(keys.calls(), 1, 'keys cached');
  } finally { keys.restore(); }
});

test('Access JWT: key rotation fetches the new keys once', async () => {
  resetAccessKeyCache();
  const first = await keyPair('old');
  const second = await keyPair('new');
  let current: JsonWebKey[] = [first.jwk];
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ keys: current }); }) as typeof fetch;
  try {
    assert.ok(await verifyAccessJwt(await sign(first.pair.privateKey, 'old', claims()), { teamDomain: team, aud }));
    current = [second.jwk];
    assert.ok(await verifyAccessJwt(await sign(second.pair.privateKey, 'new', claims()), { teamDomain: team, aud }));
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('ownerOf in Access mode: email allow-list, service tokens and missing configuration refused', async () => {
  resetAccessKeyCache();
  const { pair, jwk } = await keyPair('k1');
  const keys = serveKeys([jwk]);
  const env = { AUTH_MODE: 'cloudflare-access', ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud };
  const req = (token?: string, extra: Record<string, string> = {}) => new Request('https://gestionale.esempio.it/api/workspace', { headers: { ...(token ? { 'cf-access-jwt-assertion': token } : {}), ...extra } });
  try {
    const good = await sign(pair.privateKey, 'k1', claims());
    assert.equal(await ownerOf(req(good), env, false), 'titolare@esempio.it');
    assert.equal(await ownerOf(req(good), { ...env, OWNER_USER_IDS: 'altro@esempio.it' }, false), null);
    assert.equal(await ownerOf(req(good), { ...env, OWNER_USER_IDS: 'TITOLARE@esempio.it, altro@esempio.it' }, false), 'titolare@esempio.it');
    assert.equal(await ownerOf(req(), env, false), null, 'no token');
    assert.equal(await ownerOf(req(undefined, { 'oai-authenticated-user-id': 'falso' }), env, false), null, 'a Sites header is not trusted in Access mode');
    assert.equal(await ownerOf(req(await sign(pair.privateKey, 'k1', claims({ email: undefined, common_name: 'ponte.access' }))), env, false), null, 'service token is not a person');
    const original = console.error; console.error = () => {};
    try { assert.equal(await ownerOf(req(good), { AUTH_MODE: 'cloudflare-access' }, false), null, 'missing configuration fails closed'); } finally { console.error = original; }
  } finally { keys.restore(); }
});

test('API route in Access mode: 401 without a valid Access token, 200 with it', async () => {
  resetAccessKeyCache();
  const { pair, jwk } = await keyPair('k1');
  const keys = serveKeys([jwk]);
  const t = await sqliteDb();
  setEnv(t.db);
  (globalThis as { __testEnv?: Record<string, unknown> }).__testEnv!.AUTH_MODE = 'cloudflare-access';
  (globalThis as { __testEnv?: Record<string, unknown> }).__testEnv!.ACCESS_TEAM_DOMAIN = team;
  (globalThis as { __testEnv?: Record<string, unknown> }).__testEnv!.ACCESS_AUD = aud;
  const route = await loadRoute<{ GET: (r: Request) => Promise<Response> }>('app/api/workspace/route.ts');
  try {
    assert.equal((await route.GET(new Request('https://gestionale.esempio.it/api/workspace', { headers: { 'oai-authenticated-user-id': 'falso' } }))).status, 401);
    const res = await route.GET(new Request('https://gestionale.esempio.it/api/workspace', { headers: { 'cf-access-jwt-assertion': await sign(pair.privateKey, 'k1', claims()) } }));
    assert.equal(res.status, 200);
  } finally { keys.restore(); await t.close(); }
});
