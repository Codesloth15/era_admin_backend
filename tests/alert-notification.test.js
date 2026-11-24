import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAlertNotifications } from '../services/alert-notification.service.js';
import { skipReason, tabukBarangay, alertMessage, MAX_ALERT_AGE_MS } from '../services/rules/alert-notification.rules.js';
import { CITY, PUSH_TOKENS, ALERT_NOTIFICATIONS } from '../config/data-paths.js';

const boundaries = JSON.parse(fs.readFileSync(new URL('../config/tabuk-barangays.json', import.meta.url), 'utf8'));
const NOW = 1_800_000_000_000;
// National Road, City of Tabuk (a real alert location) and Manila (outside the city).
const TABUK = { latitude: 17.4428316, longitude: 121.4535439, address: 'CFV3+5CG, National Road, City of Tabuk' };
const MANILA = { latitude: 14.5995, longitude: 120.9842, address: 'Manila' };
const alert = (overrides = {}) => ({ type: 'FIRE', priority: 'HIGH', status: 'RECEIVED', isSimulation: false, createdAt: NOW - 1000, location: TABUK, ...overrides });

function setup({ users = {}, tokens = {}, send } = {}) {
  const data = {};
  const get = path => path.split('/').reduce((value, part) => value?.[part], data) ?? null;
  const set = (path, value) => {
    const parts = path.split('/'); const last = parts.pop();
    const parent = parts.reduce((node, part) => (node[part] ||= {}), data);
    if (value === null) delete parent[last]; else parent[last] = value;
  };
  set(`${CITY}/users`, users);
  set(PUSH_TOKENS, tokens);
  const repository = {
    async read(path) { return structuredClone(get(path)); },
    async transact(path, change) { set(path, change(structuredClone(get(path)))); },
    async removeIf(path, shouldRemove) {
      const current = get(path);
      if (current !== null && !shouldRemove(structuredClone(current))) return false;
      set(path, null);
      return true;
    },
  };
  const sent = [];
  const push = {
    async send(message, tokenList) {
      sent.push({ message, tokens: tokenList });
      return send ? send(tokenList) : tokenList.map(token => ({ token, ok: true, errorCode: null }));
    },
  };
  const service = createAlertNotifications({ repository, push, boundaries, now: () => NOW });
  return { service, sent, log: id => get(`${ALERT_NOTIFICATIONS}/${id}`), token: uid => get(`${PUSH_TOKENS}/${uid}`) };
}

test('alerts that are simulated, finished, too old or have no time are not pushed', () => {
  assert.equal(skipReason(alert(), NOW), null);
  assert.equal(skipReason(alert({ isSimulation: true }), NOW), 'SIMULATION');
  for (const status of ['RESOLVED', 'CANCELLED', 'CLOSED']) assert.equal(skipReason(alert({ status }), NOW), 'FINISHED');
  assert.equal(skipReason(alert({ createdAt: NOW - MAX_ALERT_AGE_MS - 1 }), NOW), 'TOO_OLD');
  assert.equal(skipReason(alert({ createdAt: undefined }), NOW), 'NO_CREATED_TIME');
  assert.equal(skipReason(null, NOW), 'NOT_AN_ALERT');
});

test('Tabuk City check uses the GPS point against the official barangay boundaries', () => {
  const inside = tabukBarangay(TABUK, boundaries);
  assert.ok(inside?.name);
  assert.match(inside.pcode, /^PH1403213\d{3}$/);
  assert.equal(tabukBarangay(MANILA, boundaries), null);
  assert.equal(tabukBarangay({ address: 'City of Tabuk' }, boundaries), null);
  assert.equal(tabukBarangay({ latitude: null, longitude: null }, boundaries), null);
  assert.equal(tabukBarangay(undefined, boundaries), null);
});

test('the message names the alert type and barangay and carries the alert key for the app', () => {
  const message = alertMessage('alert1', alert({ type: 'ROAD_ACCIDENT' }), { name: 'Bulanao', pcode: 'PH1403213010' });
  assert.equal(message.notification.title, 'New road accident alert');
  assert.equal(message.notification.body, `Brgy. Bulanao · ${TABUK.address}`);
  assert.deepEqual(message.data, { incidentId: 'alert1', type: 'ROAD_ACCIDENT', priority: 'HIGH' });
  assert.deepEqual(message.android, { priority: 'high', notification: { channelId: 'emergency_alerts' } });
  assert.equal(alertMessage('a', alert({ type: 'MEDICAL', location: { ...TABUK, address: '' } }), { name: 'Bulanao' }).notification.body, 'Brgy. Bulanao');
  assert.equal(alertMessage('a', alert({ type: 'MEDICAL' }), { name: 'X' }).notification.title, 'New rescue alert');
  assert.equal(alertMessage('a', alert({ type: 'SOMETHING' }), { name: 'X' }).notification.title, 'New emergency alert');
});

test('a Tabuk alert goes once to every active responder with a token, and the result is logged', async () => {
  const s = setup({
    users: {
      fire: { role: 'RESPONDER', active: true, agencyId: 'BFP' },
      police: { role: 'RESPONDER', active: true, agencyId: 'PNP' },
      noToken: { role: 'RESPONDER', active: true, agencyId: 'PNP' },
      retired: { role: 'RESPONDER', active: false, agencyId: 'BFP' },
      admin: { role: 'SYSTEM_ADMIN', active: true },
    },
    tokens: { fire: { fcmToken: 'tokenFire' }, police: { fcmToken: 'tokenPolice' }, retired: { fcmToken: 'tokenRetired' }, admin: { fcmToken: 'tokenAdmin' } },
  });
  const outcome = await s.service.notifyNewIncident('alert1', alert());
  assert.equal(outcome.status, 'SENT');
  assert.equal(s.sent.length, 1);
  assert.deepEqual(s.sent[0].tokens.sort(), ['tokenFire', 'tokenPolice']);
  assert.equal(s.sent[0].message.data.incidentId, 'alert1');
  const log = s.log('alert1');
  assert.equal(log.status, 'SENT'); assert.equal(log.recipients, 2); assert.equal(log.successCount, 2); assert.equal(log.failureCount, 0);
  assert.equal(log.claimedAt, NOW); assert.equal(log.finishedAt, NOW); assert.ok(log.barangay);
  assert.equal(JSON.stringify(log).includes('token'), false);

  assert.deepEqual(await s.service.notifyNewIncident('alert1', alert()), { status: 'ALREADY_HANDLED' });
  assert.equal(s.sent.length, 1);
});

test('an alert outside Tabuk City or without a GPS point is logged but never pushed', async () => {
  const s = setup({ users: { fire: { role: 'RESPONDER', active: true } }, tokens: { fire: { fcmToken: 'tokenFire' } } });
  assert.equal((await s.service.notifyNewIncident('manila', alert({ location: MANILA }))).status, 'OUTSIDE_TABUK');
  assert.equal((await s.service.notifyNewIncident('noGps', alert({ location: { address: 'City of Tabuk' } }))).status, 'OUTSIDE_TABUK');
  assert.equal(s.sent.length, 0);
  assert.equal(s.log('manila').status, 'OUTSIDE_TABUK');
});

test('skipped alerts write nothing, and no responder tokens are logged as no recipients', async () => {
  const s = setup({ users: { fire: { role: 'RESPONDER', active: true } } });
  assert.deepEqual(await s.service.notifyNewIncident('old', alert({ createdAt: NOW - MAX_ALERT_AGE_MS - 1 })), { status: 'SKIPPED', reason: 'TOO_OLD' });
  assert.equal(s.log('old'), null);
  assert.equal((await s.service.notifyNewIncident('alert2', alert())).status, 'NO_RECIPIENTS');
  assert.equal(s.log('alert2').recipients, 0);
  assert.equal(s.sent.length, 0);
});

test('dead tokens are removed unless the phone saved a new one; other failures keep the token', async () => {
  const s = setup({
    users: { a: { role: 'RESPONDER', active: true }, b: { role: 'RESPONDER', active: true }, c: { role: 'RESPONDER', active: true } },
    tokens: { a: { fcmToken: 'dead' }, b: { fcmToken: 'busy' }, c: { fcmToken: 'ok' } },
    send: tokens => tokens.map(token => ({
      token,
      ok: token === 'ok',
      errorCode: token === 'dead' ? 'messaging/registration-token-not-registered' : token === 'busy' ? 'messaging/internal-error' : null,
    })),
  });
  const outcome = await s.service.notifyNewIncident('alert3', alert());
  assert.equal(outcome.status, 'SENT');
  assert.equal(outcome.successCount, 1); assert.equal(outcome.failureCount, 2); assert.equal(outcome.removedTokens, 1);
  assert.equal(s.token('a'), null);
  assert.deepEqual(s.token('b'), { fcmToken: 'busy' });
  assert.deepEqual(s.token('c'), { fcmToken: 'ok' });
});

test('a token replaced while sending is kept', async () => {
  let replace;
  const s = setup({
    users: { a: { role: 'RESPONDER', active: true } },
    tokens: { a: { fcmToken: 'old' } },
    send: tokens => { replace(); return tokens.map(token => ({ token, ok: false, errorCode: 'messaging/registration-token-not-registered' })); },
  });
  replace = () => s.token('a') && Object.assign(s.token('a'), { fcmToken: 'new' });
  const outcome = await s.service.notifyNewIncident('alert4', alert());
  assert.equal(outcome.status, 'FAILED'); assert.equal(outcome.removedTokens, 0);
  assert.deepEqual(s.token('a'), { fcmToken: 'new' });
});

test('a sending error is logged as failed instead of being left in progress', async () => {
  const s = setup({
    users: { a: { role: 'RESPONDER', active: true } },
    tokens: { a: { fcmToken: 'tokenA' } },
    send: () => { throw Object.assign(new Error('offline'), { code: 'app/network-error' }); },
  });
  assert.deepEqual(await s.service.notifyNewIncident('alert5', alert()), { status: 'FAILED', errorCode: 'app/network-error' });
  assert.equal(s.log('alert5').status, 'FAILED');
  assert.equal(s.log('alert5').finishedAt, NOW);
});

test('more than 500 phones are sent in batches of 500', async () => {
  const users = {}; const tokens = {};
  for (let index = 0; index < 1203; index += 1) { users[`r${index}`] = { role: 'RESPONDER', active: true }; tokens[`r${index}`] = { fcmToken: `t${index}` }; }
  const s = setup({ users, tokens });
  const outcome = await s.service.notifyNewIncident('alert6', alert());
  assert.deepEqual(s.sent.map(batch => batch.tokens.length), [500, 500, 203]);
  assert.equal(outcome.successCount, 1203);
});
