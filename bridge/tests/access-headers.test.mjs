import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJson } from '../core/transmitter.mjs';
import { validateAccess } from '../core/config.mjs';

test('credenziali Cloudflare Access: inviate solo se configurate, entrambe obbligatorie', async () => {
  const seen = [];
  const fetchImpl = async (_url, init) => { seen.push(init.headers); return new Response('{"ok":true}', { status: 200 }); };
  await requestJson({ fetchImpl, url: 'https://gestionale.esempio.it/api/devices/production', method: 'GET', token: 'pcd_prova', timeoutMs: 1000 });
  const access = validateAccess({ accessClientId: 'id-prova.access', accessClientSecret: 'segreto-di-prova-abcdefgh' });
  await requestJson({ fetchImpl, url: 'https://gestionale.esempio.it/api/devices/production', method: 'GET', token: 'pcd_prova', access, timeoutMs: 1000 });
  assert.equal(seen[0]['cf-access-client-id'], undefined);
  assert.equal(seen[1]['cf-access-client-id'], 'id-prova.access');
  assert.equal(seen[1]['cf-access-client-secret'], 'segreto-di-prova-abcdefgh');
  assert.equal(validateAccess({}), null);
  assert.equal(validateAccess({ accessClientId: null, accessClientSecret: null }), null);
  assert.throws(() => validateAccess({ accessClientId: 'solo-id-senza-segreto' }), /entrambi|sia accessClientId/);
});
