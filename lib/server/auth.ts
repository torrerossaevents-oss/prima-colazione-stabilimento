/**
 * Owner identity for API routes. Two hosting modes:
 *
 * - "sites" (default, current hosting): the platform authenticates the user and adds
 *   `oai-authenticated-user-id`. Trusted only behind that platform.
 * - "cloudflare-access": Cloudflare Access sits in front of the Worker and signs every
 *   request with `Cf-Access-Jwt-Assertion` (RS256). The signature, issuer (team domain),
 *   audience (application AUD tag) and expiry are verified here against the team's public
 *   keys; plain headers are never trusted. Missing configuration = access denied.
 *
 * Profiles (lib/permissions.ts): ADMIN_EMAILS = amministrazione, LAB_EMAILS = laboratorio
 * (one shared credential each). Values are platform user ids on Sites, email addresses with Cloudflare Access.
 * OWNER_USER_IDS is the former name of ADMIN_EMAILS. With no list configured everyone who
 * passes the hosting gate is back office (previous behaviour); with lists, anyone else is refused.
 */
import type { Role } from '../permissions.ts';
export type AuthEnv = { AUTH_MODE?: string; OWNER_USER_IDS?: string; ADMIN_EMAILS?: string; LAB_EMAILS?: string; ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string };
export type Identity = { id: string; role: Role };
type Jwk = JsonWebKey & { kid?: string };

const encoder = new TextEncoder();
const KEY_TTL_MS = 60 * 60 * 1000;
let keyCache: { url: string; at: number; keys: Jwk[] } | null = null;

function base64url(input: string): Uint8Array {
  const b64 = input.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
const decodeJson = (part: string) => JSON.parse(new TextDecoder().decode(base64url(part)));
const allowList = (value?: string) => (value ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const normalizeTeam = (team: string) => team.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();

async function accessKeys(team: string, refresh: boolean): Promise<Jwk[]> {
  const url = `https://${team}/cdn-cgi/access/certs`;
  if (!refresh && keyCache && keyCache.url === url && Date.now() - keyCache.at < KEY_TTL_MS) return keyCache.keys;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Chiavi di Cloudflare Access non disponibili (${res.status}).`);
  const data = await res.json() as { keys?: Jwk[] };
  if (!Array.isArray(data.keys) || !data.keys.length) throw new Error('Chiavi di Cloudflare Access non valide.');
  keyCache = { url, at: Date.now(), keys: data.keys };
  return data.keys;
}

export type AccessIdentity = { sub: string; email?: string; commonName?: string };

/** Verifies a Cloudflare Access JWT. Returns null for any invalid token; throws only if the keys cannot be fetched. */
export async function verifyAccessJwt(token: string, options: { teamDomain: string; aud: string; now?: number }): Promise<AccessIdentity | null> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
  let header: { alg?: string; kid?: string }, payload: Record<string, unknown>;
  try { header = decodeJson(parts[0]); payload = decodeJson(parts[1]); } catch { return null; }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
  const team = normalizeTeam(options.teamDomain);
  let keys = await accessKeys(team, false);
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) { keys = await accessKeys(team, true); jwk = keys.find(k => k.kid === header.kid); }
  if (!jwk) return null;
  const material: JsonWebKey & { kid?: string } = { ...jwk };
  delete material.kid;
  const key = await crypto.subtle.importKey('jwk', { ...material, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signature = base64url(parts[2]);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature as BufferSource, encoder.encode(`${parts[0]}.${parts[1]}`) as BufferSource);
  if (!valid) return null;
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== `https://${team}`) return null;
  if (!aud.includes(options.aud)) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= now - 30) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > now + 30) return null;
  if (typeof payload.sub !== 'string') return null;
  return { sub: payload.sub, ...(typeof payload.email === 'string' ? { email: payload.email } : {}), ...(typeof payload.common_name === 'string' ? { commonName: payload.common_name } : {}) };
}

function roleFor(id: string, env: AuthEnv): Role | null {
  const admins = allowList(env.ADMIN_EMAILS || env.OWNER_USER_IDS);
  const lab = allowList(env.LAB_EMAILS);
  if (!admins.length && !lab.length) return 'amministrazione';
  const key = id.toLowerCase();
  if (admins.includes(key)) return 'amministrazione';
  if (lab.includes(key)) return 'laboratorio';
  return null;
}

/**
 * Who is calling and with which profile, or null if the request must be refused.
 * `dev` = local preview without the hosting gate (never expose it on a network).
 */
export async function identify(request: Request, env: AuthEnv, dev: boolean): Promise<Identity | null> {
  let id: string | null = null;
  if ((env.AUTH_MODE ?? 'sites') === 'cloudflare-access') {
    const token = request.headers.get('cf-access-jwt-assertion');
    if (!token) return dev ? { id: 'anteprima-locale', role: 'amministrazione' } : null;
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) { console.error('Cloudflare Access non configurato: accesso negato.'); return null; }
    let identity: AccessIdentity | null;
    try { identity = await verifyAccessJwt(token, { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD }); }
    catch (error) { console.error('Verifica Cloudflare Access non riuscita:', error instanceof Error ? error.message : 'errore'); return null; }
    // A person is required: service tokens (no email) are for the bridge, not for these routes.
    if (!identity?.email) return null;
    id = identity.email.toLowerCase();
  } else {
    id = request.headers.get('oai-authenticated-user-id');
    if (!id) return dev ? { id: 'anteprima-locale', role: 'amministrazione' } : null;
  }
  const role = roleFor(id, env);
  return role ? { id, role } : null;
}

/** Back-compatible helper: the identifier only. */
export async function ownerOf(request: Request, env: AuthEnv, dev: boolean): Promise<string | null> {
  return (await identify(request, env, dev))?.id ?? null;
}

/** Test hook: forget cached Access keys. */
export function resetAccessKeyCache() { keyCache = null; }
