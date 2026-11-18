import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { errorHandler } from '../middleware/error.middleware.js';
test('HTTP API verifies tokens, returns permission errors, and binds the actor to the verified UID', async () => {
  const calls = [];
  const auth = { async verifyIdToken(token, revoked) { assert.equal(revoked, true); if (token !== 'valid-token') throw new Error('Invalid'); return { uid: 'actual-actor' }; } };
  const service = {
    async list(uid) { calls.push(uid); return { agencies: [], invitations: [] }; },
    async createAgency(uid, body) { calls.push([uid, body]); throw Object.assign(new Error('System administrator required.'), { status: 403 }); },
    async createResponder(uid, agencyId, body) { calls.push({ uid, agencyId, body }); return { uid: 'new-responder', agencyId }; },
    async agencyDispatchData(uid, collection) { calls.push({ uid, collection }); return { data: {} }; },
    async agencyDispatchCommand(uid, body) { calls.push({ uid, body }); return { message: 'Saved' }; },
    async ownerSession(uid) { calls.push({ owner: uid }); return { profile: { role: 'SYSTEM_ADMIN', active: true } }; },
    async consolidateAccountRole(uid) { calls.push({ migratedUid: uid }); return { migrated: true }; },
    async stationDirectory(uid) { calls.push({ stationsFor: uid }); return { data: {} }; },
    async ownerList(uid) { calls.push({ ownerList: uid }); return { agencies: [], invitations: [] }; },
    async createAgencyAdmin(uid, agencyId, body) { calls.push({ owner: uid, agencyId, body }); return { uid: 'agency-admin', agencyId }; },
  };
  const server = createApp({ service, auth }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/agencies`;
  try {
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(base, { headers: { Authorization: 'Bearer invalid' } })).status, 401);
    const valid = await fetch(base, { headers: { Authorization: 'Bearer valid-token' } });
    assert.deepEqual(await valid.json(), { agencies: [], invitations: [] });
    assert.equal(calls[0], 'actual-actor');
    const denied = await fetch(base, { method: 'POST', headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ actorUid: 'forged-root' }) });
    assert.equal(denied.status, 403); assert.equal(calls[1][0], 'actual-actor');
    assert.equal((await denied.json()).error, 'System administrator required.');
    const responderBody = { displayName: 'Fire responder', email: 'fire@example.com', password: 'secret123', actorUid: 'forged-root' };
    const responder = await fetch(`${base}/BFP/responders`, {
      method: 'POST', headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(responderBody),
    });
    assert.equal(responder.status, 200);
    assert.deepEqual(await responder.json(), { uid: 'new-responder', agencyId: 'BFP' });
    assert.deepEqual(calls[2], { uid: 'actual-actor', agencyId: 'BFP', body: responderBody });
    assert.equal((await fetch(`${base}/dispatch-data?collection=incidents`, { headers: { Authorization: 'Bearer valid-token' } })).status, 200);
    assert.deepEqual(calls[3], { uid: 'actual-actor', collection: 'incidents' });
    const commandBody = { action: 'dispatch', incidentId: 'fire', actorUid: 'forged-root' };
    assert.equal((await fetch(`${base}/dispatch-command`, { method: 'POST', headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' }, body: JSON.stringify(commandBody) })).status, 200);
    assert.deepEqual(calls[4], { uid: 'actual-actor', body: commandBody });
    assert.equal((await fetch(`${base}/owner/session`, { headers: { Authorization: 'Bearer valid-token' } })).status, 200);
    assert.deepEqual(calls[5], { owner: 'actual-actor' });
    assert.equal((await fetch(`${base}/owner`, { headers: { Authorization: 'Bearer valid-token' } })).status, 200);
    assert.deepEqual(calls[6], { ownerList: 'actual-actor' });
    const adminBody = { displayName: 'Agency Admin', email: 'admin@example.com', password: 'Initial123', actorUid: 'forged-root' };
    assert.equal((await fetch(`${base}/BFP/admins`, { method: 'POST', headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' }, body: JSON.stringify(adminBody) })).status, 200);
    assert.deepEqual(calls[7], { owner: 'actual-actor', agencyId: 'BFP', body: adminBody });
    assert.equal((await fetch(`${base}/account-role`, { method: 'POST', headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: 'forged-root' }) })).status, 200);
    assert.deepEqual(calls[8], { migratedUid: 'actual-actor' });
    assert.equal((await fetch(`${base}/stations`, { headers: { Authorization: 'Bearer valid-token' } })).status, 200);
    assert.deepEqual(calls[9], { stationsFor: 'actual-actor' });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('hotline routes reach the hotline handlers, not the station and team handler', async () => {
  const calls = [];
  const auth = { async verifyIdToken() { return { uid: 'actual-actor' }; } };
  const service = {
    async agencyDirectory(uid) { calls.push({ directoryFor: uid }); return { data: { BFP: { hotline: '160' } } }; },
    async updateAgencyHotline(uid, agencyId, body) { calls.push({ uid, agencyId, body }); return { message: 'Hotline saved.' }; },
    async saveResource() { throw new Error('The hotline request reached the station and team handler.'); },
  };
  const server = createApp({ service, auth }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/agencies`;
  const headers = { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' };
  try {
    assert.deepEqual(await (await fetch(`${base}/directory`, { headers })).json(), { data: { BFP: { hotline: '160' } } });
    const saved = await fetch(`${base}/BFP/hotline`, { method: 'POST', headers, body: JSON.stringify({ hotline: '160' }) });
    assert.equal(saved.status, 200);
    assert.deepEqual(calls, [{ directoryFor: 'actual-actor' }, { uid: 'actual-actor', agencyId: 'BFP', body: { hotline: '160' } }]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});


test('unexpected Firebase failures return a diagnostic code without exposing upstream details', () => {
  const original = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  let status, body;
  try {
    errorHandler(Object.assign(new Error('upstream diagnostic'), { code: 'auth/insufficient-permission' }),
      { method: 'POST', path: '/api/agencies/BARANGAY/responders' },
      { status(value) { status = value; return this; }, json(value) { body = value; } });
    assert.equal(status, 500);
    assert.equal(body.code, 'auth/insufficient-permission');
    assert.match(body.error, /lacks permission/);
    assert.equal(body.error.includes('upstream diagnostic'), false);
    assert.equal(logs[0][1].message, 'upstream diagnostic');
  } finally { console.error = original; }
});
