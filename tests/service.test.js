import { test } from 'vitest';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../services/agency.service.js';
import { CITY } from '../config/data-paths.js';
import { code, hotline } from '../services/rules/agency.rules.js';
import { routeIncident } from '../services/rules/incident.rules.js';
import { createFirebaseDependencies } from '../database/firebase.js';
import { readConfig } from '../config/env.js';

test('response reports enforce team submission, agency review, correction and immutable approval', async () => {
  const s = await responderSetup();
  s.city().users.responder = { role: 'RESPONDER', active: true, agencyId: 'BFP', teamId: 'fireTeam', displayName: 'Fire responder' };
  s.city().users.other = { role: 'RESPONDER', active: true, agencyId: 'BFP', teamId: 'otherTeam' };
  s.city().agency.BFP.teams = { fireTeam: { name: 'Fire team', stationId: 'fireStation' } };
  s.data.incidents = { incident: { type: 'FIRE', createdAt: 100, description: 'House fire', location: { address: 'Tabuk' } } };
  s.data.dispatch_assignments = { assignment: { incidentId: 'incident', agencyId: 'BFP', teamId: 'fireTeam' } };
  const input = { assignmentId: 'assignment', vehicleUsed: 'Engine 1', callTime: 100, dispatchTime: 200, arrivalTime: 300, completionTime: 400,
    numberOfCasualties: 0, patients: [], sceneAssessment: 'Fire contained', actionsTaken: 'Extinguished fire', assistanceProvided: 'Evacuation',
    incidentOutcome: 'Resolved', respondingPersonnel: 'Fire responder', supportingPhotos: [], status: 'APPROVED', agencyId: 'PNP', submittedBy: 'forged' };
  await assert.rejects(s.service.submitResponseReport('other', input), /assigned responding team/);
  await assert.rejects(s.service.submitResponseReport('policeAdmin', input), /assigned responding team/);
  await assert.rejects(s.service.submitResponseReport('responder', { ...input, arrivalTime: 50 }), /order/);
  await assert.rejects(s.service.submitResponseReport('responder', { ...input, supportingPhotos: ['javascript:alert(1)'] }), /HTTPS/);
  const result = await s.service.submitResponseReport('responder', input);
  const report = () => s.city().command_center.response_reports[result.id];
  assert.equal(report().status, 'PENDING_REVIEW'); assert.equal(report().agencyId, 'BFP'); assert.equal(report().submittedBy, 'responder');
  assert.equal(report().stationName, 'Fire station'); assert.equal(report().incidentLocation, 'Tabuk'); assert.equal(report().submittedAt, 1000);
  assert.equal(Object.keys((await s.service.responseReportData('policeAdmin')).reports).length, 0);
  assert.equal(Object.keys((await s.service.responseReportData('other')).reports).length, 0);
  assert.equal(Object.keys((await s.service.responseReportData('other')).assignments).length, 0);
  await assert.rejects(s.service.reviewResponseReport('policeAdmin', result.id, { status: 'APPROVED' }), /agency administrator/);
  await assert.rejects(s.service.reviewResponseReport('responder', result.id, { status: 'APPROVED' }), /agency administrator/);
  await assert.rejects(s.service.reviewResponseReport('fireAdmin', result.id, { status: 'RETURNED' }), /review remarks/);
  await s.service.reviewResponseReport('fireAdmin', result.id, { status: 'RETURNED', reviewRemarks: 'Clarify actions.' });
  await assert.rejects(s.service.submitResponseReport('other', { ...input, reportId: result.id }), /returned report/);
  await s.service.submitResponseReport('responder', { ...input, reportId: result.id, actionsTaken: 'Fire extinguished with water.' });
  assert.equal(report().revision, 2); assert.equal(report().previousReviews[0].reviewRemarks, 'Clarify actions.');
  await s.service.reviewResponseReport('fireAdmin', result.id, { status: 'APPROVED' });
  assert.equal(report().status, 'APPROVED'); assert.equal(report().reviewedBy, 'fireAdmin');
  await assert.rejects(s.service.reviewResponseReport('fireAdmin', result.id, { status: 'RETURNED', reviewRemarks: 'Again' }), /already been reviewed/);
  await assert.rejects(s.service.submitResponseReport('responder', { ...input, reportId: result.id }), /returned report/);
  await s.service.submitResponseReport('responder', input);
  assert.equal(Object.keys((await s.service.responseReportData('fireAdmin')).reports).length, 2);
  const manual = await s.service.submitResponseReport('fireAdmin', { ...input, status: 'PENDING_REVIEW', approvalRequired: true });
  const saved = s.city().command_center.response_reports[manual.id];
  assert.equal(saved.status, 'APPROVED'); assert.equal(saved.approvalRequired, false);
  assert.equal(saved.creationSource, 'AGENCY_MANUAL'); assert.equal(saved.agencyId, 'BFP');
  assert.equal(saved.submittedBy, 'fireAdmin'); assert.equal(saved.reviewedBy, undefined);
  s.data.incidents.manualIncident = { type: 'FIRE', leadAgencyId: 'BFP', createdAt: 100, description: 'Manual team response' };
  const manualInput = { ...input, assignmentId: '', incidentId: 'manualIncident', teamName: '  Volunteer rescue team  ' };
  const available = await s.service.responseReportData('fireAdmin');
  assert.ok(available.incidents.manualIncident);
  assert.equal(Object.values(available.assignments).some(item => item.incidentId === 'manualIncident'), false);
  const typedTeam = await s.service.submitResponseReport('fireAdmin', manualInput);
  const typedSaved = s.city().command_center.response_reports[typedTeam.id];
  assert.equal(typedSaved.teamName, 'Volunteer rescue team'); assert.equal(typedSaved.teamId, null);
  assert.equal(typedSaved.assignmentId, null); assert.equal(typedSaved.incidentId, 'manualIncident');
  assert.equal(typedSaved.status, 'APPROVED');
  const standaloneInput = { ...manualInput, incidentId: '', emergencyType: 'Medical emergency', incidentDateTime: 100,
    incidentLocation: 'Manually entered address, Tabuk', descriptionCause: 'Patient requested assistance.' };
  const standalone = await s.service.submitResponseReport('fireAdmin', standaloneInput);
  const standaloneSaved = s.city().command_center.response_reports[standalone.id];
  assert.equal(standaloneSaved.incidentId, null); assert.equal(standaloneSaved.incidentLocation, standaloneInput.incidentLocation);
  assert.equal(standaloneSaved.emergencyType, standaloneInput.emergencyType); assert.equal(standaloneSaved.status, 'APPROVED');
  assert.equal(standaloneSaved.incidentDateTime, 100); assert.equal(standaloneSaved.descriptionCause, standaloneInput.descriptionCause);
  const xmlInput = { emergencyType: 'ROAD_ACCIDENT', TIME_CALL: '23:00', TIME_ARRIVAL: '23:15', DATE: '2026-11-06', NAME_OF_CALLER: 'Caller', CONCERN: 'Road accident', SCENE_LOCATION: 'Manually typed location', AMBULANCE: 'Ambulance 1', CASUALTY: 1, TEAM: 'Volunteer team', TAG: 'Yellow',
    patients: [{ Firstname: 'Ana', Lastname: 'Cruz', PATIENT_AGE: 30, PATIENT_ADDRESS: 'Tabuk', PATIENT_RELIGION: 'Catholic', PATIENT_STATUS: 'Stable', PATIENT_INJURY: 'Arm injury', PATIENT_GENDER_spinner: 'Female', PATIENT_CIVIL_STATUS_spinner: 'Single' }] };
  const xmlResult = await s.service.submitResponseReport('fireAdmin', xmlInput);
  const xmlSaved = s.city().command_center.response_reports[xmlResult.id];
  for (const field of Object.keys(xmlInput).filter(name => name !== 'patients')) assert.deepEqual(xmlSaved[field], xmlInput[field]);
  // Structured answers are stored as empty when not given (older reports have none).
  assert.deepEqual(xmlSaved.patients, xmlInput.patients.map(patient => ({ ...patient, VICTIM_ROLE: '', LICENSED: '', SEVERITY: '' })));
  assert.equal(xmlSaved.status, 'APPROVED'); assert.equal(xmlSaved.incidentId, null);
  assert.equal(xmlSaved.sceneAssessment, undefined); assert.equal(xmlSaved.schemaVersion, 2);
  const responderXml = await s.service.submitResponseReport('responder', { ...xmlInput, assignmentId: 'assignment', status: 'APPROVED' });
  assert.equal(s.city().command_center.response_reports[responderXml.id].status, 'PENDING_REVIEW');
  await assert.rejects(s.service.submitResponseReport('responder', xmlInput), /assigned responding team/);
  await assert.rejects(s.service.submitResponseReport('fireAdmin', { ...xmlInput, DATE: '2026-02-30' }), /Invalid Date/);
  await assert.rejects(s.service.submitResponseReport('fireAdmin', { ...xmlInput, TIME_CALL: '25:00' }), /Call Time/);
  // Every structured report needs an incident type (from the form, or the incident it is filed on).
  await assert.rejects(s.service.submitResponseReport('fireAdmin', { ...xmlInput, emergencyType: '' }), /Choose the type of emergency/);
  await assert.rejects(s.service.submitResponseReport('fireAdmin', { ...xmlInput, emergencyType: 'BOGUS' }), /Choose the type of emergency/);
  await assert.rejects(s.service.submitResponseReport('fireAdmin', { ...xmlInput, TIME_ARRIVAL: '25:00' }), /Arrival Time/);
  await assert.rejects(s.service.submitResponseReport('fireAdmin', { ...xmlInput, CASUALTY: 0 }), /patient list/);
  assert.equal(s.data.incidents[standalone.id], undefined);
  await assert.rejects(s.service.submitResponseReport('fireAdmin', { ...standaloneInput, incidentLocation: ' ' }), /incident location/);
  await assert.rejects(s.service.submitResponseReport('fireAdmin', { ...standaloneInput, incidentDateTime: null }), /date and time/);
  await assert.rejects(s.service.submitResponseReport('responder', standaloneInput), /assigned responding team/);
  await assert.rejects(s.service.submitResponseReport('fireAdmin', { ...manualInput, teamName: '  ' }), /responding team/);
  await assert.rejects(s.service.submitResponseReport('policeAdmin', manualInput), /outside your agency/);
  await assert.rejects(s.service.submitResponseReport('responder', manualInput), /assigned responding team/);
  await assert.rejects(s.service.reviewResponseReport('fireAdmin', manual.id, { status: 'APPROVED' }), /already been reviewed/);
  await assert.rejects(s.service.submitResponseReport('fireAdmin', { ...input, reportId: result.id }), /cannot replace/);
  s.city().users.responder.active = false;
  await assert.rejects(s.service.responseReportData('responder'), /Active ERA/);
});

test('command admins manage stations and responder assignments without privileged agency access', async () => {
  const s = await responderSetup();
  s.city().users.command = { role: 'COMMAND_ADMIN', active: true };
  const responder = await s.service.createResponder('fireAdmin', 'BFP', s.input);
  await s.service.saveResource('command', 'BFP', 'stations', { id: 'newStation', name: 'New station', location: 'Tabuk', latitude: 17.4, longitude: 121.4 });
  await s.service.assignStation('command', 'BFP', { uid: responder.uid, stationId: 'newStation' });
  assert.equal(s.city().users[responder.uid].stationId, 'newStation');
  assert.equal(s.city().agency.BFP.members[responder.uid].stationId, 'newStation');
  assert.equal(s.city().agency.BFP.responders[responder.uid].stationId, 'newStation');
  assert.equal((await s.service.list('command')).agencies.length, 2);
  await assert.rejects(s.service.assignStation('command', 'PNP', { uid: responder.uid, stationId: null }), /does not belong/);
  await assert.rejects(s.service.assignStation('command', 'BFP', { uid: responder.uid, stationId: 'missing' }), /Station does not belong/);
  await assert.rejects(s.service.saveResource('command', 'BFP', 'teams', { name: 'Team' }), /permission/);
  await assert.rejects(s.service.createAgency('command', { emergencyTypes: ['FIRE'], name: 'Other', code: 'OTHER', type: 'OTHER', contactEmail: 'office@example.com', contactNumber: '123', address: 'Tabuk' }), /permission/);
  await assert.rejects(s.service.status('command', 'BFP', { active: false }), /permission/);
  await s.service.assignStation('command', 'BFP', { uid: responder.uid, stationId: null });
  assert.equal(s.city().users[responder.uid].stationId, null);
  s.city().users.command.active = false;
  await assert.rejects(s.service.list('command'), /permission/);
});

test('missing database configuration gives setup instructions before initializing Firebase', () => {
  assert.throws(() => createFirebaseDependencies({}), /FIREBASE_DATABASE_URL is required.*era_admin_backend\/\.env/);
  assert.throws(() => createFirebaseDependencies({ FIREBASE_DATABASE_URL: '  ' }), /FIREBASE_DATABASE_URL is required/);
});

test('settings: server names first, old REACT_APP_ names still work, key path starts from era_admin_backend', () => {
  const config = readConfig({
    FIREBASE_DATABASE_URL: ' https://new-db ', REACT_APP_FIREBASE_DATABASE_URL: 'https://old-db',
    REACT_APP_FIREBASE_STORAGE_BUCKET: 'old-bucket', FIREBASE_SERVICE_ACCOUNT_PATH: './keys/admin.json', PORT: ' ',
  });
  assert.equal(config.port, 5000);
  assert.equal(config.firebase.databaseURL, 'https://new-db');
  assert.equal(config.firebase.storageBucket, 'old-bucket');
  assert.equal(config.firebase.serviceAccountPath, path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'keys', 'admin.json'));
  assert.equal(readConfig({}).firebase.serviceAccountPath, undefined);
});

test('hotlines accept short codes, landlines, mobile and toll-free numbers', () => {
  assert.equal(hotline('911'), '911');
  assert.equal(hotline('  (074)   627-1234 '), '(074) 627-1234');
  assert.equal(hotline('+63 74 627 1234'), '+63 74 627 1234');
  assert.equal(hotline('1-800-10-123-4567'), '1-800-10-123-4567');
  assert.equal(hotline('09776226185'), '09776226185');
  assert.equal(hotline('+63 977 622 6185'), '+63 977 622 6185');
  assert.equal(hotline(''), '');
  assert.equal(hotline(undefined), '');
  assert.throws(() => hotline('call 911'), /hotline such as 911/);
  assert.throws(() => hotline('12'), /hotline such as 911/);
  assert.throws(() => hotline(160), /Invalid hotline/);
});

test('agency hotline: the agency admin sets their own, system admins any agency, others are refused', async () => {
  const s = await responderSetup();
  assert.equal((await s.service.updateAgencyHotline('fireAdmin', 'BFP', { hotline: ' 160 ' })).message, 'Hotline saved.');
  assert.equal(s.city().agency.BFP.profile.hotline, '160');
  await assert.rejects(s.service.updateAgencyHotline('fireAdmin', 'PNP', { hotline: '117' }), /denied/);
  await assert.rejects(s.service.updateAgencyHotline('fireAdmin', 'BFP', { hotline: 'call 160' }), /hotline such as 911/);
  await s.service.updateAgencyHotline('root', 'PNP', { hotline: '117' });
  assert.equal(s.city().agency.PNP.profile.hotline, '117');
  s.city().users.command = { role: 'COMMAND_ADMIN', active: true };
  await assert.rejects(s.service.updateAgencyHotline('command', 'BFP', { hotline: '911' }), /permission/);
  assert.equal((await s.service.updateAgencyHotline('fireAdmin', 'BFP', { hotline: '' })).message, 'Hotline removed.');
  assert.equal('hotline' in s.city().agency.BFP.profile, false);
  const audit = Object.values(s.city().command_center.audit_logs).filter(entry => entry.action === 'AGENCY_HOTLINE_UPDATED');
  assert.deepEqual(audit.map(entry => [entry.actorUid, entry.agencyId]), [['fireAdmin', 'BFP'], ['root', 'PNP'], ['fireAdmin', 'BFP']]);
});

test('agency directory gives signed-in staff public agency details with hotlines only', async () => {
  const s = await responderSetup();
  await s.service.updateAgencyHotline('root', 'BFP', { hotline: '(074) 627-1234' });
  const { data } = await s.service.agencyDirectory('policeAdmin');
  assert.deepEqual(Object.keys(data.BFP).sort(), ['active', 'emergencyTypes', 'hotline', 'id', 'name', 'type', 'types']);
  assert.equal(data.BFP.hotline, '(074) 627-1234');
  assert.equal(data.PNP.hotline, '');
  s.city().users.responder = { role: 'RESPONDER', agencyId: 'BFP', active: true };
  await assert.rejects(s.service.agencyDirectory('responder'), /permission/);
});

test('station hotline is saved with the station and kept when an edit sends none', async () => {
  const s = await responderSetup();
  const station = { id: 'fireStation', name: 'Fire station', location: 'Bulanao', latitude: 17.45, longitude: 121.45 };
  await s.service.saveResource('fireAdmin', 'BFP', 'stations', { ...station, hotline: '160' });
  assert.equal(s.city().agency.BFP.stations.fireStation.hotline, '160');
  await s.service.saveResource('fireAdmin', 'BFP', 'stations', { ...station, location: 'Bulanao, Tabuk' });
  assert.equal(s.city().agency.BFP.stations.fireStation.hotline, '160');
  await assert.rejects(s.service.saveResource('fireAdmin', 'BFP', 'stations', { ...station, hotline: 'call us' }), /hotline such as 911/);
  assert.equal((await s.service.stationDirectory('root')).data.fireStation.hotline, '160');
});

test('a new agency can start with a hotline', async () => {
  const s = setup();
  await s.service.createAgency('root', { emergencyTypes: ['FIRE'], name: 'Bureau of Fire Protection', code: 'BFP', type: 'FIRE', contactEmail: 'bfp@example.com', contactNumber: '0746271234', address: 'Tabuk', hotline: '160' });
  assert.equal(s.city().agency.BFP.profile.hotline, '160');
  await s.create('PNP');
  assert.equal('hotline' in s.city().agency.PNP.profile, false);
});
function setup() {
  const data = { users: { root: { role: 'SYSTEM_ADMIN', active: true } }, server: { 'City of Tabuk': {} } };
  let counter = 0;
  const get = path => path === '/' ? data : path.split('/').reduce((value, part) => value?.[part], data) ?? null;
  const repo = {
    async read(path) { return structuredClone(get(path)); },
    async transact(path, transform) {
      if (path === '/') {
        const next = transform(structuredClone(data));
        for (const name of Object.keys(data)) delete data[name];
        Object.assign(data, next);
        return;
      }
      const parts = path.split('/'); const key = parts.pop(); const parent = parts.reduce((value, part) => value[part], data);
      parent[key] = transform(structuredClone(parent[key]));
    },
  };
  const accounts = new Map();
  const auth = {
    async createUser(input) {
      if ([...accounts.values()].some(account => account.email === input.email)) {
        throw Object.assign(new Error('Duplicate'), { code: 'auth/email-already-exists' });
      }
      const account = { uid: `auth_${++counter}`, ...input };
      accounts.set(account.uid, account);
      return account;
    },
    async deleteUser(uid) { accounts.delete(uid); },
    async getUser(uid) { return { uid, email: uid === 'wrong' ? 'wrong@example.com' : 'admin@example.com', emailVerified: uid !== 'unverified', disabled: uid === 'disabled' }; },
    async getUserByEmail() { throw Object.assign(new Error('Missing'), { code: 'auth/user-not-found' }); } };
  let time = 1000;
  const stored = new Map();
  const files = { async save(path, buffer, contentType) { stored.set(path, { buffer, contentType }); return `https://files.test/${path}`; }, async remove(path) { stored.delete(path); } };
  const service = createService({ repository: repo, auth, files, id: () => `id_${++counter}`, now: () => time });
  const city = () => get(CITY);
  const create = (agencyCode = 'PNP') => service.createAgency('root', { emergencyTypes: ['FIRE'], name: 'Philippine National Police', code: agencyCode, type: 'POLICE', contactEmail: 'office@example.com', contactNumber: '09123456789', address: 'Tabuk' });
  const invite = () => service.invite('root', 'PNP', { displayName: 'Agency Admin', email: 'admin@example.com' });
  return { data, service, city, create, invite, auth, accounts, repo, stored, tick: () => { time += 1; }, expire: () => { time += 8 * 86400000; } };
}
test('normalizes agency codes and prevents alias duplication', () => {
  assert.equal(code(' pnp '), 'PNP'); assert.throws(() => code('CDRRMC')); assert.throws(() => code('PNP/OTHER'));
});

test('agency actions record verified agency snapshots and closure time rather than client claims', async () => {
  const s = await responderSetup();
  s.city().agency.BFP.profile.name = 'BFP';
  s.data.incidents = { fire: { leadAgencyId: 'BFP', status: 'VERIFIED', version: 1 } };
  await s.service.agencyDispatchCommand('fireAdmin', { action: 'acknowledge', incidentId: 'fire', agencyId: 'PNP', agencyName: 'Fake agency' });
  assert.equal(s.data.incidents.fire.acknowledgedByAgencyId, 'BFP');
  assert.equal(s.data.incidents.fire.acknowledgedByAgencyName, 'BFP');
  assert.equal(s.data.incidents.fire.acknowledgedAt, 1000);
  s.city().agency.BFP.profile.name = 'Fire and Rescue';
  await s.service.agencyDispatchCommand('fireAdmin', { action: 'close', status: 'CANCELLED', incidentId: 'fire', expectedVersion: 2, agencyId: 'PNP' });
  const incident = s.data.incidents.fire;
  assert.equal(incident.closedByAgencyId, 'BFP');
  assert.equal(incident.closedByAgencyName, 'Fire and Rescue');
  assert.equal(incident.closedBy, 'fireAdmin');
  assert.equal(incident.closedAt, 1000);
  const events = Object.values(s.data.incident_events.fire);
  assert.equal(events.find(event => event.type === 'INCIDENT_ACKNOWLEDGED').agencyName, 'BFP');
  assert.equal(events.find(event => event.type === 'INCIDENT_CANCELLED').agencyName, 'Fire and Rescue');
});

test('shared agency pages expose only their staff, teams, jobs and shared locations', async () => {
  const s = await responderSetup();
  s.city().users.fireStaff = { role: 'RESPONDER', active: true, agencyId: 'BFP', displayName: 'Fire staff', email: 'fire@example.com', password: 'private', teamId: 'fireTeam' };
  s.city().users.policeStaff = { role: 'RESPONDER', active: true, agencyId: 'PNP', displayName: 'Police staff' };
  s.city().agency.BFP.teams = { fireTeam: { name: 'Fire team', stationId: 'fireStation' } };
  s.data.teams = { policeTeam: { agencyId: 'PNP', name: 'Police team' } };
  s.data.dispatch_assignments = { own: { agencyId: 'BFP', teamId: 'fireTeam', incidentId: 'fire' }, other: { agencyId: 'PNP', teamId: 'policeTeam' } };
  s.data.notification_jobs = { own: { targetType: 'TEAM', targetId: 'fireTeam', assignmentId: 'own' }, other: { targetType: 'TEAM', targetId: 'policeTeam', assignmentId: 'other' }, inconsistent: { targetType: 'TEAM', targetId: 'fireTeam', assignmentId: 'other' } };
  s.city().shared_locations = { fireStaff: { latitude: 17.4, longitude: 121.4 }, policeStaff: { latitude: 17.5, longitude: 121.5 } };
  const staff = (await s.service.agencyDispatchData('fireAdmin', 'users')).data;
  assert.equal(staff.fireStaff.displayName, 'Fire staff');
  assert.equal(staff.fireStaff.password, undefined);
  assert.equal(staff.policeStaff, undefined);
  assert.deepEqual(Object.keys((await s.service.agencyDispatchData('fireAdmin', 'teams')).data), ['fireTeam']);
  assert.deepEqual(Object.keys((await s.service.agencyDispatchData('fireAdmin', 'notification_jobs')).data), ['own']);
  assert.deepEqual(Object.keys((await s.service.agencyDispatchData('fireAdmin', 'server/City of Tabuk/shared_locations')).data), ['fireStaff']);
});

test('station maps include newly saved agency stations and merge legacy records with canonical precedence', async () => {
  const s = await responderSetup();
  s.city().users.command = { role: 'COMMAND_ADMIN', active: true };
  s.data.stations = { old: { name: 'Legacy station', agencyId: 'BFP', latitude: 17.1, longitude: 121.1 }, saved: { name: 'Old copy', agencyId: 'BFP', latitude: 1, longitude: 2 } };
  s.city().stations = { city: { name: 'City station', agencyId: 'PNP', location: { latitude: 17.2, longitude: 121.2 } } };
  await s.service.saveResource('command', 'BFP', 'stations', { id: 'saved', name: 'New fire station', location: 'Bulanao, Tabuk', latitude: 17.45, longitude: 121.45 });
  const result = (await s.service.stationDirectory('command')).data;
  assert.equal(result.saved.name, 'New fire station');
  assert.equal(result.saved.agencyId, 'BFP');
  assert.deepEqual(result.saved.location, { latitude: 17.45, longitude: 121.45, address: 'Bulanao, Tabuk', displayLabel: 'New fire station' });
  assert.equal(result.old.location.latitude, 17.1);
  assert.equal(result.city.location.latitude, 17.2);
  const own = (await s.service.stationDirectory('fireAdmin')).data;
  assert.equal(own.city, undefined);
  assert.equal(own.saved.location.longitude, 121.45);
  assert.deepEqual((await s.service.agencyDispatchData('fireAdmin', 'stations')).data.saved, own.saved);
  s.city().agency.PNP.profile.active = false;
  assert.equal((await s.service.stationDirectory('command')).data.city, undefined);
  s.city().users.responder = { role: 'RESPONDER', active: true, agencyId: 'BFP' };
  await assert.rejects(s.service.stationDirectory('responder'), /permission/);
});

test('station maps normalize initial station coordinates without inventing missing coordinates', async () => {
  const s = setup();
  await s.service.createAgency('root', { emergencyTypes: ['FIRE'], name: 'Fire', code: 'BFP', type: 'FIRE', contactEmail: 'office@example.com', contactNumber: '123', address: 'Tabuk', station: { name: 'Initial station', location: 'Tabuk', latitude: 17.4, longitude: 121.4 } });
  s.data.stations = { blank: { latitude: '', longitude: null }, simulation: { name: 'Simulation station', location: { latitude: '17.5', longitude: '121.5', source: 'SIMULATION_ONLY' } } };
  const stations = (await s.service.stationDirectory('root')).data;
  assert.equal(stations.BFP_INITIAL.location.latitude, 17.4);
  assert.equal(stations.BFP_INITIAL.agencyId, 'BFP');
  assert.equal(stations.blank.location.latitude, undefined);
  assert.equal(stations.blank.location.longitude, undefined);
  assert.equal(stations.simulation.location.latitude, 17.5);
  assert.equal(stations.simulation.isSimulation, true);
});

test('retired command accounts transition atomically and cannot be selected for new invitations', async () => {
  const s = setup(); await s.create('BFP');
  s.data.users.operator = { role: 'COMMAND_DISPATCHER', active: true, email: 'admin@example.com', agencyId: 'BFP' };
  await s.service.consolidateAccountRole('operator');
  assert.equal(s.data.users.operator.role, 'COMMAND_ADMIN');
  assert.equal(s.data.users.operator.active, true);
  assert.equal((await s.service.list('operator')).agencies.length, 1);
  assert.equal((await s.service.consolidateAccountRole('operator')).migrated, false);
  await assert.rejects(s.service.invite('root', 'BFP', { role: 'COMMAND_DISPATCHER' }), /Unsupported role/);
  await assert.rejects(s.service.invite('root', 'BFP', { role: 'AGENCY_DISPATCHER' }), /Unsupported role/);
});

test('agency dispatcher transition preserves inactivity and revoked access', async () => {
  const s = setup(); await s.create('BFP');
  const old = { role: 'AGENCY_DISPATCHER', active: true, email: 'admin@example.com', agencyId: 'BFP' };
  s.city().users = { operator: { ...old, active: false } };
  s.data.users.operator = { ...old };
  s.city().agency.BFP.members = { operator: { ...old, active: false } };
  await s.service.consolidateAccountRole('operator');
  assert.equal(s.city().users.operator.role, 'AGENCY_ADMIN');
  assert.equal(s.city().users.operator.active, false);
  assert.equal(s.city().users.operator.authProvisioned, true);
  assert.equal(s.city().agency.BFP.members.operator.role, 'AGENCY_ADMIN');
  assert.equal(s.city().agency.BFP.members.operator.active, false);
  await assert.rejects(s.service.dashboard('operator'), /permission/);
  s.city().users.operator = { ...old };
  s.city().agency_invitations = { revoked: { uid: 'operator', role: 'AGENCY_DISPATCHER', status: 'REVOKED' } };
  await s.service.consolidateAccountRole('operator');
  assert.equal(s.city().users.operator.active, false);
  assert.equal(s.city().agency_invitations.revoked.role, 'AGENCY_ADMIN');
});

test('role transition rejects a mismatched login and leaves existing administrator permissions alone', async () => {
  const s = setup(); await s.create('BFP');
  s.data.users.operator = { role: 'COMMAND_DISPATCHER', email: 'someone-else@example.com', active: true };
  await assert.rejects(s.service.consolidateAccountRole('operator'), /verify the existing account/);
  assert.equal(s.data.users.operator.role, 'COMMAND_DISPATCHER');
  s.data.users.operator = { role: 'AGENCY_ADMIN', authProvisioned: false, agencyId: 'BFP', active: true };
  assert.equal((await s.service.consolidateAccountRole('operator')).migrated, false);
  assert.equal(s.data.users.operator.authProvisioned, false);
});

test('owner app endpoints reject staff and owner-created admin accounts never store passwords', async () => {
  const s = await responderSetup();
  s.city().users.command = { role: 'COMMAND_ADMIN', active: true };
  for (const uid of ['command', 'fireAdmin']) {
    await assert.rejects(s.service.ownerSession(uid), /permission|denied/);
    await assert.rejects(s.service.ownerList(uid), /permission|denied/);
    await assert.rejects(s.service.createAgencyAdmin(uid, 'BFP', s.input), /permission|denied/);
  }
  assert.equal(s.accounts.size, 0);
  assert.equal((await s.service.ownerSession('root')).profile.role, 'SYSTEM_ADMIN');
  assert.equal((await s.service.ownerList('root')).agencies.length, 2);
  const result = await s.service.createAgencyAdmin('root', 'BFP', { ...s.input, role: 'SYSTEM_ADMIN' });
  const saved = s.city().users[result.uid];
  assert.equal(saved.role, 'AGENCY_ADMIN');
  assert.equal(saved.agencyId, 'BFP');
  assert.equal(saved.authProvisioned, true);
  assert.equal(saved.active, true);
  assert.equal(saved.password, undefined);
  assert.deepEqual(s.city().agency.BFP.members[result.uid], saved);
  assert.equal(s.city().agency.BFP.responders?.[result.uid], undefined);
  assert.equal(s.accounts.get(result.uid).password, s.input.password);
  await assert.rejects(s.service.createAgencyAdmin('root', 'BFP', s.input), /already exists/);
});

test('owner admin creation rechecks access and cleans up Auth after a failed save', async () => {
  const s = await responderSetup();
  const originalCreate = s.auth.createUser;
  s.auth.createUser = async input => {
    const account = await originalCreate(input);
    s.data.users.root.active = false;
    return account;
  };
  await assert.rejects(s.service.createAgencyAdmin('root', 'BFP', s.input), /permission/);
  assert.equal(s.accounts.size, 0);
  assert.equal(Object.values(s.city().users).some(user => user.email === 'fire@example.com'), false);
});

test('agency admins remove a station by hiding it and unassigning its teams and people', async () => {
  const s = await responderSetup();
  s.city().agency.BFP.stations.northStation = { name: 'North station', location: 'Tabuk', latitude: 17.4, longitude: 121.4 };
  s.city().agency.BFP.teams = { fireTeam: { name: 'Fire team', stationId: 'fireStation' }, northTeam: { name: 'North team', stationId: 'northStation' } };
  s.city().users.responder = { role: 'RESPONDER', active: true, agencyId: 'BFP', teamId: 'fireTeam', stationId: 'fireStation', displayName: 'Fire responder' };
  s.city().users.keeper = { role: 'RESPONDER', active: true, agencyId: 'BFP', stationId: 'northStation' };
  s.city().agency.BFP.members = { responder: { ...s.city().users.responder }, keeper: { ...s.city().users.keeper } };
  s.city().agency.BFP.responders = { responder: { memberUid: 'responder', active: true, stationId: 'fireStation' } };
  s.data.teams = { fireTeam: { agencyId: 'BFP', name: 'Fire team', stationId: 'fireStation' } };

  await assert.rejects(s.service.deactivateStation('policeAdmin', 'BFP', 'fireStation', { confirmation: 'Fire station' }), /denied/);
  await assert.rejects(s.service.deactivateStation('fireAdmin', 'BFP', 'fireStation', { confirmation: 'Fire' }), /Type the station name/);
  await assert.rejects(s.service.deactivateStation('fireAdmin', 'BFP', 'missing', { confirmation: 'missing' }), /does not belong/);
  s.data.dispatch_assignments = { busy: { incidentId: 'one', teamId: 'fireTeam', status: 'EN_ROUTE' } };
  await assert.rejects(s.service.deactivateStation('fireAdmin', 'BFP', 'fireStation', { confirmation: 'fire STATION' }), /active assignment/);
  s.data.dispatch_assignments.busy.status = 'COMPLETED';

  await s.service.deactivateStation('fireAdmin', 'BFP', 'fireStation', { confirmation: ' fire STATION ' });
  assert.equal(s.city().agency.BFP.stations.fireStation.active, false);
  assert.equal(s.city().agency.BFP.teams.fireTeam.stationId, null);
  assert.equal(s.data.teams.fireTeam.stationId, null);
  assert.equal(s.city().users.responder.stationId, null);
  assert.equal(s.city().users.responder.teamId, 'fireTeam');
  assert.equal(s.city().agency.BFP.members.responder.stationId, null);
  assert.equal(s.city().agency.BFP.responders.responder.stationId, null);
  assert.equal(s.city().users.keeper.stationId, 'northStation');
  assert.equal(s.city().agency.BFP.teams.northTeam.stationId, 'northStation');
  assert.ok(Object.values(s.city().command_center.audit_logs).some(item => item.action === 'STATION_DEACTIVATED' && item.resourceId === 'fireStation'));
  assert.equal((await s.service.list('fireAdmin')).agencies[0].stations.fireStation, undefined);
  await assert.rejects(s.service.assignStation('fireAdmin', 'BFP', { uid: 'responder', stationId: 'fireStation' }), /does not belong/);
  await assert.rejects(s.service.saveResource('fireAdmin', 'BFP', 'teams', { id: 'fireTeam', name: 'Fire team', stationId: 'fireStation' }), /Invalid agency station/);
  await assert.rejects(s.service.deactivateStation('fireAdmin', 'BFP', 'northStation', { confirmation: 'North station' }), /at least one station/);
});

test('only System Administrators create Command Center admins, with a saved record and no password in data', async () => {
  const s = await responderSetup();
  const input = { displayName: 'Command Admin', email: ' Command@Example.com ', password: 'secret123' };
  await assert.rejects(s.service.createCommandAdmin('fireAdmin', input), /denied/);
  await assert.rejects(s.service.createCommandAdmin('root', { ...input, password: '123' }), /Password must/);
  const result = await s.service.createCommandAdmin('root', input);
  const account = s.accounts.get(result.uid);
  assert.equal(account.email, 'command@example.com');
  const user = s.city().users[result.uid];
  assert.equal(user.role, 'COMMAND_ADMIN');
  assert.equal(user.active, true);
  assert.equal(user.agencyId, undefined);
  assert.equal(JSON.stringify(s.data).includes('secret123'), false);
  assert.equal(JSON.stringify(result).includes('secret123'), false);
  assert.ok(Object.values(s.city().command_center.audit_logs).some(item => item.action === 'COMMAND_ADMIN_CREATED' && item.targetUid === result.uid));
  await assert.rejects(s.service.createCommandAdmin('root', input), /already exists/);
});

test('agencies take several types and keep the first one as the main type', async () => {
  const s = setup();
  const base = { name: 'Fire and Rescue', code: 'BFP', contactEmail: 'office@example.com', contactNumber: '09123456789', address: 'Tabuk' };
  await s.service.createAgency('root', { emergencyTypes: ['FIRE'], ...base, types: ['FIRE', 'RESCUE', 'MEDICAL', 'FIRE'] });
  const profile = s.city().agency.BFP.profile;
  assert.deepEqual(profile.types, ['FIRE', 'RESCUE', 'MEDICAL']);
  assert.equal(profile.type, 'FIRE');
  await assert.rejects(s.service.createAgency('root', { emergencyTypes: ['FIRE'], ...base, code: 'EMPTY', types: [] }), /at least one/);
  await assert.rejects(s.service.createAgency('root', { emergencyTypes: ['FIRE'], ...base, code: 'BADTYPE', types: ['FIRE', 'SPACE'] }), /Invalid agency type/);
  await assert.rejects(s.service.createAgency('root', { emergencyTypes: ['FIRE'], ...base, code: 'NOTYPE' }), /Invalid agency type/);
  const directory = await s.service.agencyDirectory('root');
  assert.deepEqual(directory.data.BFP.types, ['FIRE', 'RESCUE', 'MEDICAL']);
});

test('agency admins choose their own agency station, and no other account can', async () => {
  const s = await responderSetup();
  s.city().agency.BFP.stations.northStation = { name: 'North station', location: 'Tabuk', latitude: 17.4, longitude: 121.4 };
  await s.service.setAdminStation('fireAdmin', { stationId: 'northStation' });
  assert.equal(s.city().users.fireAdmin.stationId, 'northStation');
  await assert.rejects(s.service.setAdminStation('fireAdmin', { stationId: 'missing' }), /does not belong/);
  await assert.rejects(s.service.setAdminStation('policeAdmin', { stationId: 'fireStation' }), /does not belong/);
  s.city().users.responder = { role: 'RESPONDER', agencyId: 'BFP', active: true };
  await assert.rejects(s.service.setAdminStation('responder', { stationId: 'fireStation' }), /permission/);
  await s.service.setAdminStation('fireAdmin', { stationId: null });
  assert.equal(s.city().users.fireAdmin.stationId, null);
});

test('agencies record the emergencies they respond to; only System Administrators change them', async () => {
  const s = setup();
  const base = { name: 'Fire and Rescue', code: 'BFP', types: ['FIRE'], contactEmail: 'office@example.com', contactNumber: '09123456789', address: 'Tabuk' };
  await s.service.createAgency('root', { ...base, emergencyTypes: ['FIRE', 'RESCUE', 'FIRE'] });
  assert.deepEqual(s.city().agency.BFP.profile.emergencyTypes, ['FIRE', 'RESCUE']);
  await assert.rejects(s.service.createAgency('root', { ...base, code: 'NONE', emergencyTypes: [] }), /at least one emergency/);
  await assert.rejects(s.service.createAgency('root', { ...base, code: 'BAD', emergencyTypes: ['SPACE'] }), /Invalid emergency type/);
  s.city().users = { fireAdmin: { role: 'AGENCY_ADMIN', agencyId: 'BFP', active: true, authProvisioned: true } };
  await assert.rejects(s.service.setAgencyEmergencies('fireAdmin', 'BFP', { emergencyTypes: ['ROAD_ACCIDENT'] }), /denied/);
  await s.service.setAgencyEmergencies('root', 'BFP', { emergencyTypes: ['ROAD_ACCIDENT', 'POLICE'] });
  assert.deepEqual(s.city().agency.BFP.profile.emergencyTypes, ['ROAD_ACCIDENT', 'POLICE']);
  assert.deepEqual((await s.service.agencyDirectory('root')).data.BFP.emergencyTypes, ['ROAD_ACCIDENT', 'POLICE']);
});

// Routing is automatic: every active agency that covers the type (emergencyTypes) and has a station with an
// available team inside the radius is recommended; the nearest one leads.
const routingAgencies = () => [
  { id: 'BFP', active: true, emergencyTypes: ['FIRE', 'ROAD_ACCIDENT'], stations: [
    { id: 'bfpMain', active: true, latitude: 17.4125, longitude: 121.444, hasAvailableTeam: true },
    { id: 'bfpSub', active: true, latitude: 17.42, longitude: 121.45, hasAvailableTeam: true },
  ] },
  { id: 'CDRRMC', active: true, emergencyTypes: ['FIRE', 'ROAD_ACCIDENT', 'RESCUE'], stations: [
    { id: 'cdrrmo', active: true, latitude: 17.415, longitude: 121.446, hasAvailableTeam: true },
  ] },
  { id: 'PNP', active: true, emergencyTypes: ['POLICE', 'FIRE', 'ROAD_ACCIDENT'], stations: [
    { id: 'pnp', active: true, latitude: 17.41, longitude: 121.44, hasAvailableTeam: true },
  ] },
];
const nearTabuk = { latitude: 17.4128, longitude: 121.4441 };

test('a Fire in Tabuk recommends every agency that covers it; the nearest qualifying station leads', () => {
  const routed = routeIncident('FIRE', nearTabuk, routingAgencies(), {});
  assert.equal(routed.leadAgencyId, 'BFP');
  assert.equal(routed.owner, 'BFP');
  assert.equal(routed.recommendedStations.BFP, 'bfpMain');
  assert.deepEqual(routed.recommendedAgencies, { BFP: true, CDRRMC: true, PNP: true });
  assert.equal(routed.routingMethod, 'NEAREST_STATION');
});

test('an agency that does not cover the type is never recommended', () => {
  const agencies = routingAgencies();
  agencies[1].emergencyTypes = ['ROAD_ACCIDENT', 'RESCUE'];
  const routed = routeIncident('FIRE', nearTabuk, agencies, {});
  assert.deepEqual(routed.recommendedAgencies, { BFP: true, PNP: true });
});

test('a Road Accident recommends every agency that covers it, and the nearest station leads', () => {
  const routed = routeIncident('ROAD_ACCIDENT', nearTabuk, routingAgencies(), {});
  assert.equal(routed.leadAgencyId, 'BFP');
  assert.deepEqual(routed.recommendedAgencies, { BFP: true, CDRRMC: true, PNP: true });
  assert.equal(routed.recommendedStations.CDRRMC, 'cdrrmo');
});

test('a Rescue incident is recommended only to agencies that cover Medical', () => {
  const routed = routeIncident('RESCUE', nearTabuk, routingAgencies(), {});
  assert.deepEqual(routed.recommendedAgencies, { CDRRMC: true });
  assert.equal(routed.leadAgencyId, 'CDRRMC');
});

test('agencies saved with the old MEDICAL and OTHER codes are recommended for Rescue and Police', () => {
  const agencies = routingAgencies();
  agencies[1].emergencyTypes = ['MEDICAL'];
  agencies[2].emergencyTypes = ['OTHER'];
  assert.deepEqual(routeIncident('RESCUE', nearTabuk, agencies, {}).recommendedAgencies, { CDRRMC: true });
  assert.deepEqual(routeIncident('POLICE', nearTabuk, agencies, {}).recommendedAgencies, { PNP: true });
});

test('when the nearest station has no available team, that agency uses its next nearest station', () => {
  const agencies = routingAgencies();
  agencies[0].stations[0].hasAvailableTeam = false;
  const routed = routeIncident('FIRE', nearTabuk, agencies, {});
  assert.equal(routed.recommendedStations.BFP, 'bfpSub');
  assert.equal(routed.leadAgencyId, 'CDRRMC');
});

test('an agency with no available team anywhere is not recommended', () => {
  const agencies = routingAgencies();
  agencies[0].stations.forEach(station => { station.hasAvailableTeam = false; });
  const routed = routeIncident('FIRE', nearTabuk, agencies, {});
  assert.equal(routed.leadAgencyId, 'CDRRMC');
  assert.deepEqual(routed.recommendedAgencies, { CDRRMC: true, PNP: true });
});

test('no qualifying station inside the radius leaves the Command Center as owner', () => {
  const far = { latitude: 18.5, longitude: 121.45 };
  const routed = routeIncident('FIRE', far, routingAgencies(), {});
  assert.equal(routed.leadAgencyId, null);
  assert.equal(routed.owner, 'COMMAND_CENTER');
  assert.equal(routed.routingMethod, 'NO_LEAD_IN_RANGE');
});

test('the radius comes from settings: a smaller radius puts the lead out of range', () => {
  const routed = routeIncident('FIRE', nearTabuk, routingAgencies(), { radiusKm: 0.001 });
  assert.equal(routed.leadAgencyId, null);
  assert.equal(routed.owner, 'COMMAND_CENTER');
});

test('an incident with no location goes to the Command Center, not to an agency picked by type', () => {
  const routed = routeIncident('FIRE', null, routingAgencies(), {});
  assert.equal(routed.owner, 'COMMAND_CENTER');
  assert.equal(routed.leadAgencyId, null);
  assert.deepEqual(routed.recommendedAgencies, {});
  assert.equal(routed.routingMethod, 'NO_LOCATION');
});

test('Command Center verification routes a citizen report once', async () => {
  const s = await responderSetup();
  s.city().users.command = { role: 'COMMAND_ADMIN', active: true };
  s.city().agency.BFP.profile.emergencyTypes = ['FIRE'];
  s.city().agency.BFP.stations.fireStation = { name: 'Fire station', latitude: 17.4125, longitude: 121.444 };
  s.city().agency.BFP.teams = { fireTeam: { active: true, status: 'AVAILABLE', stationId: 'fireStation' } };
  s.data.incidents = { report: { type: 'FIRE', needsOperatorVerification: true, leadAgencyId: 'CDRRMO', recommendedAgencies: { CDRRMO: true }, location: { latitude: 17.4128, longitude: 121.4441 }, version: 1 } };
  await assert.rejects(s.service.verifyIncident('fireAdmin', 'report'), /Command Center access/);
  await s.service.verifyIncident('command', 'report');
  const incident = s.data.incidents.report;
  assert.equal(incident.leadAgencyId, 'BFP');
  assert.deepEqual(incident.recommendedAgencies, { BFP: true });
  assert.equal(incident.needsOperatorVerification, false);
  assert.equal(incident.version, 2);
  await assert.rejects(s.service.verifyIncident('command', 'report'), /already been verified/);
});

test('every administrator creates their own stations and deploys from one; responders are refused', async () => {
  const s = await responderSetup();
  s.city().agency.BFP.stations.fireStation = { name: 'Fire station', latitude: 17.4125, longitude: 121.444 };
  s.city().users.command = { role: 'COMMAND_ADMIN', active: true, displayName: 'Ops' };
  s.city().users.root = { role: 'SYSTEM_ADMIN', active: true, displayName: 'Owner' };
  const station = { name: 'Ops post', location: 'Tabuk', latitude: 17.4, longitude: 121.44 };
  await assert.rejects(s.service.createCommandStation('responder', station), /permission/);
  await assert.rejects(s.service.setAdminStation('command', { stationId: 'fireStation' }), /station you created/);
  const agencyCreated = await s.service.createCommandStation('fireAdmin', { ...station, name: 'Fire HQ' });
  assert.equal(s.city().command_stations[agencyCreated.id].createdBy, 'fireAdmin');
  assert.equal(s.city().command_stations[agencyCreated.id].agencyId, undefined);
  await s.service.setAdminStation('fireAdmin', { stationId: agencyCreated.id });
  assert.equal(s.city().users.fireAdmin.stationSource, 'COMMAND_CENTER');
  assert.equal((await s.service.agencyDispatchData('fireAdmin', 'stations')).data[agencyCreated.id].latitude, 17.4);
  assert.equal((await s.service.stationDirectory('fireAdmin')).data[agencyCreated.id].agencyId, 'BFP');
  await s.service.setAdminStation('fireAdmin', { stationId: 'fireStation' });
  assert.equal(s.city().users.fireAdmin.stationSource, null);
  const created = await s.service.createCommandStation('command', station);
  assert.equal(s.city().command_stations[created.id].createdBy, 'command');
  await s.service.setAdminStation('command', { stationId: created.id });
  assert.equal(s.city().users.command.stationId, created.id);
  assert.equal((await s.service.accountStation('command')).location.stationId, created.id);
  await assert.rejects(s.service.setAdminStation('command', { stationId: 'missing' }), /station you created/);
  await s.service.setAdminStation('command', { stationId: null });
  assert.equal(s.city().users.command.stationId, null);
  await s.service.setAdminStation('root', { stationId: created.id });
  assert.equal((await s.service.accountStation('root')).location.stationId, created.id);
  const listed = await s.service.commandStations('command');
  assert.deepEqual(Object.keys(listed.data).sort(), [agencyCreated.id, created.id].sort());
  assert.deepEqual(Object.keys((await s.service.commandStations('fireAdmin')).data).sort(), [agencyCreated.id, created.id].sort());
  // The station directory lists Command Center stations for command administrators, not for agency-scoped accounts.
  assert.equal((await s.service.stationDirectory('command')).data[created.id].latitude, 17.4);
  assert.equal((await s.service.stationDirectory('fireAdmin')).data[created.id], undefined);
  assert.equal((await s.service.agencyDispatchData('fireAdmin', 'stations')).data[created.id], undefined);
});

async function responderSetup() {
  const s = setup();
  await s.create('BFP');
  await s.create('PNP');
  s.city().users = {
    fireAdmin: { role: 'AGENCY_ADMIN', agencyId: 'BFP', active: true, authProvisioned: true },
    policeAdmin: { role: 'AGENCY_ADMIN', agencyId: 'PNP', active: true, authProvisioned: true },
  };
  s.city().agency.BFP.stations = { fireStation: { name: 'Fire station' } };
  s.input = { displayName: 'Fire Responder', email: ' Fire@Example.com ', password: ' initial-secret ', stationId: 'fireStation', phoneNumber: '0917 123 4567' };
  return s;
}

test('only a responder on the assigned team can acknowledge a dispatch, and only once', async () => {
  const s = await responderSetup();
  s.city().users.responder = { role: 'RESPONDER', agencyId: 'BFP', teamId: 'fireTeam', active: true, displayName: 'Fire Responder' };
  s.city().users.otherResponder = { role: 'RESPONDER', agencyId: 'BFP', teamId: 'otherTeam', active: true };
  s.data.dispatch_assignments = { a1: { incidentId: 'fire', agencyId: 'BFP', teamId: 'fireTeam', status: 'PENDING_ACKNOWLEDGMENT', assignedAt: 100 } };
  await assert.rejects(s.service.acknowledgeAssignment('otherResponder', 'a1'), /assigned team/);
  await assert.rejects(s.service.acknowledgeAssignment('fireAdmin', 'a1'), /assigned team/);
  await assert.rejects(s.service.acknowledgeAssignment('responder', 'missing'), /assigned team/);
  assert.equal((await s.service.acknowledgeAssignment('responder', 'a1')).message, 'Assignment acknowledged.');
  const saved = s.data.dispatch_assignments.a1;
  assert.equal(saved.status, 'ACKNOWLEDGED'); assert.equal(saved.acknowledgedBy, 'responder');
  assert.equal(saved.acknowledgedByName, 'Fire Responder'); assert.ok(saved.acknowledgedAt > 0);
  assert.equal((await s.service.acknowledgeAssignment('responder', 'a1')).message, 'Assignment was already acknowledged.');
  s.data.dispatch_assignments.a1.status = 'COMPLETED';
  await assert.rejects(s.service.acknowledgeAssignment('responder', 'a1'), /can no longer be acknowledged/);
});

test('agency admins create Firebase responders in their own agency with no approval or password in data', async () => {
  const s = await responderSetup();
  const result = await s.service.createResponder('fireAdmin', 'bfp', { ...s.input, agencyId: 'PNP', uid: 'forged' });
  const account = s.accounts.get(result.uid);
  assert.equal(account.email, 'fire@example.com');
  assert.equal(account.password, s.input.password);
  assert.equal(account.emailVerified, false);
  const user = s.city().users[result.uid];
  assert.equal(user.agencyId, 'BFP');
  assert.equal(user.role, 'RESPONDER');
  assert.equal(user.stationId, 'fireStation');
  assert.equal(user.authProvisioned, true);
  assert.equal(user.active, true);
  assert.deepEqual(s.city().agency.BFP.members[result.uid], user);
  assert.deepEqual(s.city().agency.BFP.responders[result.uid], { memberUid: result.uid, active: true });
  assert.equal(s.city().agency.PNP.members, undefined);
  assert.equal(s.city().agency_invitations, undefined);
  assert.equal(JSON.stringify(s.data).includes('initial-secret'), false);
  assert.equal(JSON.stringify(result).includes('initial-secret'), false);
  assert.ok(Object.values(s.city().command_center.audit_logs).some(item => item.action === 'RESPONDER_CREATED' && item.targetUid === result.uid));

  const police = await s.service.createResponder('policeAdmin', 'PNP', { displayName: 'Police responder', email: 'police@example.com', password: 'secret123', phoneNumber: '09181234567' });
  assert.equal(s.city().agency.PNP.members[police.uid].agencyId, 'PNP');
  assert.equal(s.city().agency.BFP.members[police.uid], undefined);
});

test('registration rejects agency crossing, privilege escalation, invalid stations and invalid passwords before Auth creation', async () => {
  const s = await responderSetup();
  await assert.rejects(s.service.createResponder('fireAdmin', 'PNP', s.input), /denied/);
  await assert.rejects(s.service.createResponder('fireAdmin', 'BFP', { ...s.input, role: 'SYSTEM_ADMIN' }), /Only responder/);
  await assert.rejects(s.service.createResponder('fireAdmin', 'BFP', { ...s.input, stationId: 'policeStation' }), /Station does not belong/);
  await assert.rejects(s.service.createResponder('fireAdmin', 'BFP', { ...s.input, password: 'short' }), /Password/);
  s.city().users.fireAdmin.active = false;
  await assert.rejects(s.service.createResponder('fireAdmin', 'BFP', s.input), /permission required/);
  assert.equal(s.accounts.size, 0);
});

test('registration refuses duplicate Auth emails and pending invitations without reassigning existing accounts', async () => {
  const s = await responderSetup();
  s.accounts.set('existing', { uid: 'existing', email: 'fire@example.com' });
  await assert.rejects(s.service.createResponder('fireAdmin', 'BFP', s.input), /already has a Firebase account/);
  assert.equal(s.accounts.size, 1);
  assert.equal(s.city().agency.BFP.members, undefined);
  s.accounts.clear();
  s.city().agency_invitations = { old: { email: 'fire@example.com', status: 'PENDING_AUTH_PROVISIONING', expiresAt: 999999 } };
  await assert.rejects(s.service.createResponder('fireAdmin', 'BFP', s.input), /invitation already exists/);
  assert.equal(s.accounts.size, 0);
});

test('registration rechecks authorization after Auth creation and removes only the newly created Auth account on failure', async () => {
  const s = await responderSetup();
  const createUser = s.auth.createUser;
  s.accounts.set('unrelated', { uid: 'unrelated', email: 'other@example.com' });
  s.auth.createUser = async input => {
    const account = await createUser(input);
    s.city().agency.BFP.profile.active = false;
    return account;
  };
  await assert.rejects(s.service.createResponder('fireAdmin', 'BFP', s.input), /inactive/);
  assert.deepEqual([...s.accounts.keys()], ['unrelated']);
  assert.equal(s.city().agency.BFP.members, undefined);
});

test('registration preserves Auth when the database committed but the response failed', async () => {
  const s = await responderSetup();
  const transact = s.repo.transact;
  s.repo.transact = async (...args) => {
    await transact(...args);
    throw new Error('Connection lost after commit');
  };
  const result = await s.service.createResponder('fireAdmin', 'BFP', s.input);
  assert.ok(s.accounts.has(result.uid));
  assert.equal(s.city().agency.BFP.members[result.uid].email, 'fire@example.com');
});

test('registration reports failed Auth cleanup instead of silently leaving an orphan account', async () => {
  const s = await responderSetup();
  s.repo.transact = async () => { throw new Error('Write failed'); };
  s.auth.deleteUser = async () => { throw new Error('Auth unavailable'); };
  await assert.rejects(s.service.createResponder('fireAdmin', 'BFP', s.input), error => error.status === 503 && /could not be removed/.test(error.message));
  assert.equal(s.accounts.size, 1);
  assert.equal(s.city().agency.BFP.members, undefined);
});

test('inactive responder profiles can be activated with the existing agency status operation', async () => {
  const s = await responderSetup();
  const result = await s.service.createResponder('fireAdmin', 'BFP', { ...s.input, active: false });
  assert.equal(s.city().users[result.uid].active, false);
  assert.notEqual(s.accounts.get(result.uid).disabled, true);
  await s.service.status('fireAdmin', 'BFP', { uid: result.uid, active: true });
  assert.equal(s.city().users[result.uid].active, true);
  assert.equal(s.city().agency.BFP.responders[result.uid].active, true);
});
test('creates one agency, rejects duplicates, audits, and preserves existing data', async () => {
  const s = setup(); s.city().command_center = { incidents: { original: { status: 'OPEN' } } };
  await s.create('pnp'); await assert.rejects(s.create('PNP'), /already exists/);
  assert.equal(s.city().agency.PNP.profile.code, 'PNP'); assert.equal(s.city().command_center.incidents.original.status, 'OPEN');
  assert.equal(s.data.users.root.role, 'SYSTEM_ADMIN'); assert.equal(Object.values(s.city().command_center.audit_logs).length, 1);
});
test('refuses canonical CDRRMO creation while a legacy branch exists', async () => {
  const s = setup(); s.city().agency = { CDRRMC: { profile: { active: true } } };
  await assert.rejects(s.create('CDRRMO'), /Migrate/);
});
test('pending invitations grant no profile; verified UID and separate approval activate access', async () => {
  const s = setup(); await s.create(); const invitation = await s.invite();
  assert.equal(s.city().users, undefined);
  await assert.rejects(s.service.provision('root', invitation.id, { uid: 'wrong' }), /does not match/);
  await assert.rejects(s.service.provision('root', invitation.id, { uid: 'unverified' }), /verified email/);
  await s.service.provision('root', invitation.id, { uid: 'actual-uid' }); assert.equal(s.city().users, undefined);
  await s.service.invitationAction('root', invitation.id, 'approve');
  const profile = s.city().users['actual-uid'];
  assert.equal(profile.role, 'AGENCY_ADMIN'); assert.equal(profile.authProvisioned, true); assert.equal(profile.active, true);
  assert.equal(profile.canDispatch, undefined);
  assert.equal(s.city().agency.PNP.members['actual-uid'].email, 'admin@example.com');
  assert.equal(Object.values(s.city().command_center.audit_logs).length, 4);
});
test('rejects duplicate invitations, expired invitations and legacy UID overwrite', async () => {
  const s = setup(); await s.create(); const invitation = await s.invite();
  await assert.rejects(s.invite(), /already exists/);
  s.data.users['legacy-uid'] = { role: 'CITIZEN', active: true };
  await assert.rejects(s.service.provision('root', invitation.id, { uid: 'legacy-uid' }), /cannot be overwritten/);
  s.expire(); await assert.rejects(s.service.provision('root', invitation.id, { uid: 'actual-uid' }), /expired/);
  assert.equal((await s.service.list('root')).invitations[0].status, 'EXPIRED');
});
test('agency admins cannot create agencies, grant privileged roles or manage another agency', async () => {
  const s = setup(); await s.create(); await s.create('BFP');
  s.city().users = { pnp: { role: 'AGENCY_ADMIN', agencyId: 'PNP', authProvisioned: true, active: true } };
  await assert.rejects(s.service.createAgency('pnp', { emergencyTypes: ['FIRE'], name: 'Other', code: 'OTHER', type: 'OTHER', contactEmail: 'a@b.com', contactNumber: '123', address: 'Tabuk' }), /denied/);
  await assert.rejects(s.service.invite('pnp', 'PNP', { displayName: 'Escalate', email: 'escalate@example.com', role: 'SYSTEM_ADMIN' }), /denied/);
  await assert.rejects(s.service.saveResource('pnp', 'BFP', 'teams', { name: 'BFP team' }), /denied/);
  await s.service.saveResource('pnp', 'PNP', 'teams', { name: 'PNP team' });
  assert.equal((await s.service.list('pnp')).agencies.length, 1);
});
test('revocation disables account and member atomically and cannot be bypassed by activating a member', async () => {
  const s = setup(); await s.create(); const invitation = await s.invite();
  await s.service.provision('root', invitation.id, { uid: 'actual-uid' }); await s.service.invitationAction('root', invitation.id, 'approve');
  await s.service.invitationAction('root', invitation.id, 'revoke');
  assert.equal(s.city().users['actual-uid'].active, false); assert.equal(s.city().agency.PNP.members['actual-uid'].active, false);
  await assert.rejects(s.service.status('root', 'PNP', { uid: 'actual-uid', active: true }), /Revoked/);
  await assert.rejects(s.service.dashboard('actual-uid'), /permission required/);
});
test('agency dashboards show all live incidents while inactive agencies are blocked', async () => {
  const s = setup(); await s.create(); await s.create('BFP');
  s.city().users = { pnp: { role: 'AGENCY_ADMIN', agencyId: 'PNP', active: true, authProvisioned: true }, bfp: { role: 'AGENCY_ADMIN', agencyId: 'BFP', active: true, authProvisioned: true } };
  s.city().command_center.incident_feed = { live: { incidentId: 'one', leadAgencyId: 'PNP', recommendedAgencies: { BFP: true } }, police: { leadAgencyId: 'PNP' }, exercise: { leadAgencyId: 'BFP', isSimulation: true } };
  assert.deepEqual(Object.keys((await s.service.dashboard('pnp')).feed), ['live', 'police']);
  assert.deepEqual(Object.keys((await s.service.dashboard('bfp')).feed), ['live', 'police']);
  await s.service.status('root', 'PNP', { active: false }); await assert.rejects(s.service.dashboard('pnp'), /inactive/);
});
test('team metadata updates preserve operational fields and validate station ownership', async () => {
  const s = setup(); await s.create(); s.city().agency.PNP.teams = { existing: { name: 'Old', available: false, assignmentId: 'original' } };
  await s.service.saveResource('root', 'PNP', 'teams', { id: 'existing', name: 'Updated' });
  assert.equal(s.city().agency.PNP.teams.existing.available, false); assert.equal(s.city().agency.PNP.teams.existing.assignmentId, 'original');
  await assert.rejects(s.service.saveResource('root', 'PNP', 'teams', { name: 'Bad', stationId: 'BFP_STATION' }), /Invalid agency station/);
  await assert.rejects(s.service.saveResource('root', 'PNP', 'teams', { id: 'existing', status: 'AVAILABLE' }), /Activate/);
  await s.service.saveResource('root', 'PNP', 'teams', { id: 'existing', active: true });
  assert.equal(s.data.teams.existing.active, true);
  assert.equal(s.data.teams.existing.status, 'UNAVAILABLE');
  await s.service.saveResource('root', 'PNP', 'teams', { id: 'existing', status: 'AVAILABLE' });
  assert.equal(s.city().agency.PNP.teams.existing.status, 'AVAILABLE');
  assert.equal(s.data.teams.existing.status, 'AVAILABLE');
  s.data.dispatch_assignments = { busy: { teamId: 'existing', incidentId: 'one', status: 'PENDING_ACKNOWLEDGMENT' } };
  await assert.rejects(s.service.saveResource('root', 'PNP', 'teams', { id: 'existing', active: false }), /active assignment/);
  s.data.dispatch_assignments.busy.status = 'COMPLETED';
  await s.service.saveResource('root', 'PNP', 'teams', { id: 'existing', active: false });
  assert.equal(s.data.teams.existing.status, 'UNAVAILABLE');
  assert.equal(s.city().agency.PNP.teams.existing.active, false);
  await assert.rejects(s.service.saveResource('root', 'PNP', 'teams', { id: 'existing', status: 'BUSY' }), /Invalid team readiness/);
  await assert.rejects(s.service.saveResource('root', 'PNP', 'teams', { id: 'missing', active: true }), /does not belong/);
  s.city().users = { other: { role: 'AGENCY_ADMIN', agencyId: 'BFP', active: true, authProvisioned: true } };
  await assert.rejects(s.service.saveResource('other', 'PNP', 'teams', { id: 'existing', active: true }), /denied/);
});
test('editing team details saves name and station even when the full team record is sent', async () => {
  const s = setup(); await s.create();
  const pnp = s.city().agency.PNP;
  pnp.stations = { ...pnp.stations, NORTH: { name: 'North station' } };
  pnp.teams = { existing: { name: 'Old', stationId: null, active: true, status: 'AVAILABLE' } };
  await s.service.saveResource('root', 'PNP', 'teams', { id: 'existing', name: 'Renamed', stationId: 'NORTH', active: true, status: 'AVAILABLE' });
  const saved = s.city().agency.PNP.teams.existing;
  assert.equal(saved.name, 'Renamed');
  assert.equal(saved.stationId, 'NORTH');
  assert.equal(saved.status, 'AVAILABLE');
});
test('changing a team station moves its responders and records the transfer', async () => {
  const s = setup(); await s.create(); await s.create('BFP');
  const pnp = s.city().agency.PNP;
  pnp.stations = { north: { name: 'North' }, south: { name: 'South' } };
  s.city().agency.BFP.stations = { bfpStation: { name: 'BFP' } };
  pnp.teams = { alpha: { name: 'Alpha', stationId: 'north', status: 'AVAILABLE' }, bravo: { name: 'Bravo', stationId: 'north' } };
  s.data.teams = { alpha: { agencyId: 'PNP', stationId: 'north' } };
  const responder = (teamId, agencyId = 'PNP') => ({ role: 'RESPONDER', agencyId, teamId, stationId: 'north', active: true });
  s.city().users = { a1: responder('alpha'), a2: responder('alpha'), b1: responder('bravo'), outsider: responder('alpha', 'BFP') };
  pnp.members = { a1: responder('alpha'), a2: responder('alpha'), b1: responder('bravo') };
  pnp.responders = { a1: { memberUid: 'a1', stationId: 'north' }, b1: { memberUid: 'b1', stationId: 'north' } };

  await s.service.saveResource('root', 'PNP', 'teams', { id: 'alpha', name: 'Alpha', stationId: 'south' });
  assert.equal(s.city().agency.PNP.teams.alpha.stationId, 'south');
  assert.equal(s.city().agency.PNP.teams.alpha.status, 'AVAILABLE');
  assert.equal(s.data.teams.alpha.stationId, 'south');
  for (const uid of ['a1', 'a2']) {
    assert.equal(s.city().users[uid].stationId, 'south');
    assert.equal(s.city().agency.PNP.members[uid].stationId, 'south');
  }
  assert.equal(s.city().agency.PNP.responders.a1.stationId, 'south');
  assert.equal(s.city().users.b1.stationId, 'north');
  assert.equal(s.city().agency.PNP.members.b1.stationId, 'north');
  assert.equal(s.city().agency.PNP.responders.b1.stationId, 'north');
  assert.equal(s.city().users.outsider.stationId, 'north');
  const audit = Object.values(s.city().command_center.audit_logs).find(entry => entry.action === 'TEAM_STATION_TRANSFERRED');
  assert.deepEqual({ ...audit, timestamp: undefined }, { actorUid: 'root', agencyId: 'PNP', resourceId: 'alpha', action: 'TEAM_STATION_TRANSFERRED',
    fromStationId: 'north', toStationId: 'south', responderUids: ['a1', 'a2'], timestamp: undefined });

  // Responders on a moved team can now be assigned to its station.
  await s.service.assignStation('root', 'PNP', { uid: 'a1', stationId: 'south' });

  // Saving without a station change does not touch responders or log a transfer.
  s.city().users.a2.stationId = 'manual';
  await s.service.saveResource('root', 'PNP', 'teams', { id: 'alpha', name: 'Alpha renamed', stationId: 'south' });
  assert.equal(s.city().users.a2.stationId, 'manual');
  assert.equal(Object.values(s.city().command_center.audit_logs).filter(entry => entry.action === 'TEAM_STATION_TRANSFERRED').length, 1);

  await assert.rejects(s.service.saveResource('root', 'PNP', 'teams', { id: 'alpha', name: 'Alpha', stationId: 'bfpStation' }), /Invalid agency station/);
  s.data.dispatch_assignments = { busy: { teamId: 'alpha', incidentId: 'one', status: 'EN_ROUTE' } };
  await assert.rejects(s.service.saveResource('root', 'PNP', 'teams', { id: 'alpha', name: 'Alpha', stationId: 'north' }), /active assignment/);
  assert.equal(s.city().agency.PNP.teams.alpha.stationId, 'south');
  assert.equal(s.city().users.a1.stationId, 'south');
  await s.service.saveResource('root', 'PNP', 'teams', { id: 'alpha', name: 'Alpha busy rename', stationId: 'south' });
  assert.equal(s.city().agency.PNP.teams.alpha.name, 'Alpha busy rename');
  s.data.dispatch_assignments.busy.status = 'COMPLETED';
  await s.service.saveResource('root', 'PNP', 'teams', { id: 'alpha', name: 'Alpha', stationId: 'north' });
  assert.equal(s.city().users.a1.stationId, 'north');
});

test('uses the approved account station and nested coordinates without accepting a client station override', async () => {
  const s = setup();
  s.data.users.fire = { active: true, role: 'AGENCY_ADMIN', authProvisioned: true, agencyId: 'BFP', stationId: 'BFP_BULANAO' };
  s.data.stations = { BFP_BULANAO: { agencyId: 'BFP', isSimulation: true, latitude: 1, longitude: 2,
    location: { displayLabel: 'BFP Bulanao', isSimulated: true, latitude: 17.4506, longitude: 121.4562 } } };
  const result = await s.service.accountStation('fire');
  assert.equal(result.location.stationId, 'BFP_BULANAO');
  assert.equal(result.location.latitude, 17.4506); assert.equal(result.location.longitude, 121.4562);
  assert.equal(result.location.isSimulated, true); assert.equal(result.location.source, 'STATION');
  s.data.users.fire.agencyId = 'PNP';
  await assert.rejects(s.service.accountStation('fire'), /does not belong/);
});
test('uses canonical station assignments, denies inactive accounts, and never substitutes another station', async () => {
  const s = setup(); await s.create('BFP');
  s.city().users = { fire: { active: true, role: 'AGENCY_ADMIN', authProvisioned: true, agencyId: 'BFP', stationId: 'BFP_BULANAO' } };
  s.city().agency.BFP.stations = { BFP_BULANAO: { name: 'BFP Bulanao', latitude: 17.4506, longitude: 121.4562 } };
  assert.equal((await s.service.accountStation('fire')).location.displayLabel, 'BFP Bulanao');
  s.city().users.fire.stationId = 'MISSING';
  await assert.rejects(s.service.accountStation('fire'), /not found/);
  s.city().users.fire.active = false;
  await assert.rejects(s.service.accountStation('fire'), /Approved account/);
  assert.equal((await s.service.accountStation('root')).location, null);
});

test('resolves an agency station when the account has an agency but no explicit stationId', async () => {
  const s = setup();
  s.data.users.fire = { active: true, role: 'AGENCY_ADMIN', authProvisioned: true, agencyId: 'BFP' };
  s.data.stations = { BFP_BULANAO: { agencyId: 'BFP', location: { latitude: 17.4506, longitude: 121.4562 } } };
  assert.equal((await s.service.accountStation('fire')).location.stationId, 'BFP_BULANAO');
  s.data.stations.BFP_DAGUPAN = { agencyId: 'BFP', latitude: 17.4, longitude: 121.4 };
  await assert.rejects(s.service.accountStation('fire'), /multiple stations/);
  s.data.agencies = { BFP: { primaryStationId: 'BFP_BULANAO' } };
  assert.equal((await s.service.accountStation('fire')).location.stationId, 'BFP_BULANAO');
  s.data.users.fire.teamId = 'FIRE_TEAM';
  s.data.teams = { FIRE_TEAM: { agencyId: 'BFP', stationId: 'BFP_DAGUPAN' } };
  assert.equal((await s.service.accountStation('fire')).location.stationId, 'BFP_DAGUPAN');
});


test('wrapped Firebase password-policy errors return actionable validation errors', async () => {
  const s = await responderSetup();
  s.auth.createUser = async () => { throw Object.assign(new Error('Missing password requirements: [Password must contain an upper case character] Raw server response: PASSWORD_DOES_NOT_MEET_REQUIREMENTS'), { code: 'auth/internal-error' }); };
  await assert.rejects(s.service.createResponder('fireAdmin', 'BFP', s.input), error => {
    assert.equal(error.status, 400);
    assert.match(error.message, /upper case character/);
    assert.equal(error.message.includes('Raw server response'), false);
    return true;
  });
  assert.equal(s.accounts.size, 0);
  assert.equal(s.city().agency.BFP.members, undefined);
});

test('agency admins dispatch through the backend with agency boundaries and atomic history', async () => {
  const s = await responderSetup();
  s.data.incidents = { fire: { leadAgencyId: 'BFP', status: 'VERIFIED', version: 1, acknowledgedByAgencyId: 'BFP', acknowledgedAt: 900 }, police: { leadAgencyId: 'PNP', status: 'VERIFIED', version: 1 } };
  s.data.agencies = { BFP: { active: true }, PNP: { active: true } };
  s.data.teams = { fireTeam: { agencyId: 'BFP', active: true, status: 'AVAILABLE' }, policeTeam: { agencyId: 'PNP', active: true, status: 'AVAILABLE' } };
  s.data.responder_locations = { fireTeam: { latitude: 17.4, longitude: 121.4, updatedAt: 1000 } };
  s.data.system_config = { dispatch: { locationFreshnessSeconds: 120 } };
  const snapshot = await s.service.agencyDispatchData('fireAdmin', 'incidents');
  assert.deepEqual(Object.keys(snapshot.data), ['fire', 'police']);
  s.data.incidents.police.acknowledgedAt = 900;
  s.data.incidents.police.acknowledgedByAgencyId = 'PNP';
  await s.service.agencyDispatchCommand('fireAdmin', { action: 'acknowledge', incidentId: 'police', agencyId: 'PNP' });
  assert.equal(s.data.incidents.police.agencyAcknowledgements.BFP.acknowledgedBy, 'fireAdmin');
  assert.equal(s.data.incidents.police.acknowledgedByAgencyId, 'PNP');
  assert.equal(s.data.incidents.police.acknowledgedAt, 900);
  const acknowledgedVersion = s.data.incidents.police.version;
  await s.service.agencyDispatchCommand('fireAdmin', { action: 'acknowledge', incidentId: 'police' });
  assert.equal(s.data.incidents.police.version, acknowledgedVersion);
  assert.deepEqual(Object.keys((await s.service.agencyDispatchData('fireAdmin', 'teams')).data), ['fireTeam']);
  await assert.rejects(s.service.agencyDispatchData('fireAdmin', 'agency_invitations'), /Unsupported/);
  await assert.rejects(s.service.agencyDispatchCommand('fireAdmin', { action: 'dispatch', incidentId: 'fire', teamId: 'policeTeam', expectedVersion: 1 }), /only from your agency/);
  s.data.incidents.police.recommendedAgencies = { BFP: true };
  await assert.rejects(s.service.agencyDispatchCommand('fireAdmin', { action: 'close', incidentId: 'police', expectedVersion: s.data.incidents.police.version, status: 'CANCELLED' }), /Only the lead agency/);
  s.city().users.fireAdmin.authProvisioned = false;
  await assert.rejects(s.service.agencyDispatchCommand('fireAdmin', { action: 'dispatch', incidentId: 'fire', teamId: 'fireTeam', expectedVersion: 1 }), /Active agency administrator/);
  s.city().users.fireAdmin.authProvisioned = true;
  s.data.incidents.fire.acknowledgedByAgencyId = 'PNP';
  await assert.rejects(s.service.agencyDispatchCommand('fireAdmin', { action: 'dispatch', incidentId: 'fire', teamId: 'fireTeam', expectedVersion: 1 }), /must acknowledge this incident before dispatching/);
  s.data.incidents.fire.acknowledgedByAgencyId = 'BFP';
  // An available team is dispatched even when its GPS location is stale.
  s.data.responder_locations.fireTeam.updatedAt = -200000;
  await s.service.agencyDispatchCommand('fireAdmin', { action: 'dispatch', incidentId: 'fire', teamId: 'fireTeam', expectedVersion: 1 });
  assert.equal(s.data.teams.fireTeam.status, 'DISPATCHED');
  const assignment = Object.values(s.data.dispatch_assignments)[0];
  assert.equal(assignment.assignedBy, 'fireAdmin');
  assert.equal(s.data.incidents.fire.version, 2);
  assert.ok(Object.values(s.data.audit_logs).some(entry => entry.action === 'TEAM_DISPATCHED'));
  await assert.rejects(s.service.agencyDispatchCommand('fireAdmin', { action: 'close', incidentId: 'fire', expectedVersion: 1, status: 'RESOLVED' }), /Incident changed/);
  await s.service.agencyDispatchCommand('fireAdmin', { action: 'close', incidentId: 'fire', expectedVersion: 2, status: 'RESOLVED' });
  assert.equal(s.data.teams.fireTeam.status, 'AVAILABLE');
  assert.equal(Object.values(s.data.dispatch_assignments)[0].status, 'COMPLETED');
  assert.equal(Object.values(s.data.notification_jobs)[0].status, 'CANCELLED');
  s.city().command_center ||= {};
  s.city().command_center.incidents = { police: { ...s.data.incidents.police } };
  s.city().command_center.incident_feed = { police: { incidentId: 'police', status: 'VERIFIED' } };
  // B3: BFP acknowledged this PNP incident but dispatched none of its own teams, so it cannot resolve it.
  await assert.rejects(s.service.agencyDispatchCommand('fireAdmin', { action: 'close', incidentId: 'police', expectedVersion: s.data.incidents.police.version, status: 'RESOLVED' }), /must dispatch one of its own teams/);
  assert.equal(s.data.incidents.police.status, 'VERIFIED');
  s.data.dispatch_assignments.bfpPoliceAssignment = { incidentId: 'police', agencyId: 'BFP', teamId: 'fireTeam', status: 'PENDING_ACKNOWLEDGMENT', isSimulation: false };
  await s.service.agencyDispatchCommand('fireAdmin', { action: 'close', incidentId: 'police', expectedVersion: s.data.incidents.police.version, status: 'RESOLVED' });
  assert.equal((await s.service.dashboard('fireAdmin')).feed.police.status, 'RESOLVED');
  s.city().users.policeAdmin = { role: 'AGENCY_ADMIN', agencyId: 'PNP', active: true, authProvisioned: true };
  assert.equal((await s.service.agencyDispatchData('policeAdmin', 'incidents')).data.police.status, 'RESOLVED');
  assert.equal((await s.service.agencyDispatchData('fireAdmin', 'incidents')).data.police.status, 'RESOLVED');
  assert.equal(s.data.incidents.police.closedByAgencyId, 'BFP');
  s.data.incidents.unacknowledged = { leadAgencyId: 'BFP', status: 'RECEIVED', version: 1 };
  await assert.rejects(s.service.agencyDispatchCommand('fireAdmin', { action: 'close', incidentId: 'unacknowledged', expectedVersion: 1, status: 'RESOLVED' }), /must dispatch one of its own teams/);
  s.city().agency.BFP.profile.active = false;
  await assert.rejects(s.service.agencyDispatchData('fireAdmin', 'incidents'), /Active agency/);
});

test('agencies that responded to or had a team dispatched to an incident can file its response report', async () => {
  const s = await responderSetup();
  const report = { TIME_CALL: '08:00', TIME_ARRIVAL: '08:10', DATE: '2026-11-10', NAME_OF_CALLER: 'Caller', CONCERN: 'Rescue', SCENE_LOCATION: 'Bulanao', AMBULANCE: 'Unit 1', CASUALTY: 0, TEAM: 'Team', TAG: '', patients: [] };
  s.data.incidents ||= {}; s.data.teams ||= {}; s.data.dispatch_assignments ||= {};
  s.data.incidents.shared = { type: 'MEDICAL', leadAgencyId: 'BFP', createdAt: 100, description: 'Shared response' };
  await assert.rejects(s.service.submitResponseReport('policeAdmin', { ...report, incidentId: 'shared' }), /outside your agency/);

  s.data.incidents.shared.agencyAcknowledgements = { PNP: { agencyId: 'PNP', acknowledgedAt: 200 } };
  const responded = await s.service.submitResponseReport('policeAdmin', { ...report, incidentId: 'shared' });
  assert.equal(s.city().command_center.response_reports[responded.id].incidentId, 'shared');

  s.data.incidents.dispatched = { type: 'FIRE', leadAgencyId: 'BFP', createdAt: 100 };
  s.data.teams.pnpRescue = { agencyId: 'PNP', active: true, status: 'DISPATCHED' };
  s.data.dispatch_assignments.commandDispatch = { incidentId: 'dispatched', teamId: 'pnpRescue', status: 'ARRIVED' };
  const dispatched = await s.service.submitResponseReport('policeAdmin', { ...report, incidentId: 'dispatched' });
  assert.equal(s.city().command_center.response_reports[dispatched.id].agencyId, 'PNP');
  assert.ok((await s.service.responseReportData('policeAdmin')).incidents.dispatched);

  s.data.dispatch_assignments.commandDispatch.isSimulation = true;
  await assert.rejects(s.service.submitResponseReport('policeAdmin', { ...report, incidentId: 'dispatched' }), /outside your agency/);
});

test('agency involvement also follows staff acknowledgements, events and city-level teams', async () => {
  const s = await responderSetup();
  const report = { TIME_CALL: '08:00', TIME_ARRIVAL: '08:10', DATE: '2026-11-10', NAME_OF_CALLER: 'Caller', CONCERN: 'Rescue', SCENE_LOCATION: 'Bulanao', AMBULANCE: 'Unit 1', CASUALTY: 0, TEAM: 'Team', TAG: '', patients: [] };
  s.data.incidents ||= {}; s.data.dispatch_assignments ||= {};
  s.city().users.pnpOperator = { role: 'AGENCY_ADMIN', agencyId: 'PNP', active: true };
  s.data.incidents.ackByUser = { type: 'FIRE', leadAgencyId: 'BFP', createdAt: 100, acknowledgedBy: 'pnpOperator' };
  assert.ok(await s.service.submitResponseReport('policeAdmin', { ...report, incidentId: 'ackByUser' }));
  s.data.incidents.ackEvent = { type: 'FIRE', leadAgencyId: 'BFP', createdAt: 100 };
  await assert.rejects(s.service.submitResponseReport('policeAdmin', { ...report, incidentId: 'ackEvent' }), /outside your agency/);
  s.city().command_center ||= {};
  s.city().command_center.incident_events = { ackEvent: { e1: { type: 'INCIDENT_ACKNOWLEDGED', actorId: 'pnpOperator', timestamp: 200 } } };
  assert.ok(await s.service.submitResponseReport('policeAdmin', { ...report, incidentId: 'ackEvent' }));
  s.data.incidents.cityTeam = { type: 'FIRE', leadAgencyId: 'BFP', createdAt: 100 };
  s.city().teams = { PNP_TEAM_X: { agencyId: 'PNP' } };
  s.data.dispatch_assignments.cityTeamDispatch = { incidentId: 'cityTeam', teamId: 'PNP_TEAM_X', status: 'ARRIVED' };
  assert.ok(await s.service.submitResponseReport('policeAdmin', { ...report, incidentId: 'cityTeam' }));
});

test('agency member lists show names and emails from user profiles', async () => {
  const s = await responderSetup();
  s.city().agency.BFP.members = { fieldResponder: { role: 'RESPONDER', active: true, status: 'PENDING_AUTH_VERIFICATION' } };
  s.city().users.fieldResponder = { role: 'RESPONDER', active: true, agencyId: 'BFP', displayName: 'Field Responder', email: 'field@example.com' };
  const member = (await s.service.list('fireAdmin')).agencies[0].members.fieldResponder;
  assert.equal(member.displayName, 'Field Responder');
  assert.equal(member.email, 'field@example.com');
  assert.equal(member.role, 'RESPONDER');
  assert.equal(s.city().agency.BFP.members.fieldResponder.displayName, undefined);
});

test('responder registration stores personal details and agency admins can update them', async () => {
  const s = await responderSetup();
  await assert.rejects(s.service.createResponder('fireAdmin', 'BFP', { ...s.input, phoneNumber: '' }), /phone number/);
  await assert.rejects(s.service.createResponder('fireAdmin', 'BFP', { ...s.input, phoneNumber: '12345' }), /Philippine mobile/);
  await assert.rejects(s.service.createResponder('fireAdmin', 'BFP', { ...s.input, birthdate: '2099-01-01' }), /16 to 100/);
  await assert.rejects(s.service.createResponder('fireAdmin', 'BFP', { ...s.input, sex: 'OTHER' }), /Invalid sex/);
  const result = await s.service.createResponder('fireAdmin', 'BFP', { ...s.input, residentialAddress: 'Bulanao, Tabuk City', birthdate: '1990-05-01', sex: 'FEMALE', emergencyContactName: 'Maria Cruz', emergencyContactPhone: '+639181234567' });
  const saved = s.city().users[result.uid];
  assert.equal(saved.phoneNumber, '09171234567');
  assert.equal(saved.residentialAddress, 'Bulanao, Tabuk City');
  assert.equal(saved.birthdate, '1990-05-01');
  assert.equal(saved.sex, 'FEMALE');
  assert.equal(saved.emergencyContactPhone, '09181234567');
  assert.equal(s.city().agency.BFP.members[result.uid].phoneNumber, '09171234567');

  await s.service.updateResponderProfile('fireAdmin', 'BFP', result.uid, { phoneNumber: '09991234567', residentialAddress: 'Dagupan', birthdate: '', sex: '', emergencyContactName: '', emergencyContactPhone: '' });
  assert.equal(s.city().users[result.uid].phoneNumber, '09991234567');
  assert.equal(s.city().users[result.uid].residentialAddress, 'Dagupan');
  assert.equal(s.city().users[result.uid].email, 'fire@example.com');
  assert.equal(s.city().agency.BFP.members[result.uid].residentialAddress, 'Dagupan');
  await assert.rejects(s.service.updateResponderProfile('policeAdmin', 'BFP', result.uid, { phoneNumber: '09991234567' }), /denied/);
  await assert.rejects(s.service.updateResponderProfile('fireAdmin', 'BFP', 'fireAdmin', { phoneNumber: '09991234567' }), /does not belong/);
  await assert.rejects(s.service.updateResponderProfile('fireAdmin', 'BFP', result.uid, { phoneNumber: '' }), /phone number/);
});

test('agency admins can register responders into a team and move or remove them', async () => {
  const s = await responderSetup();
  s.city().agency.BFP.teams = { team1: { name: 'Team 1', stationId: 'fireStation', active: true }, team2: { name: 'Team 2', active: true } };
  const created = await s.service.createResponder('fireAdmin', 'BFP', { ...s.input, teamId: 'team1' });
  assert.equal(s.city().users[created.uid].teamId, 'team1');
  assert.equal(s.city().users[created.uid].stationId, 'fireStation');
  assert.equal(s.city().agency.BFP.members[created.uid].teamId, 'team1');
  const shown = (await s.service.dashboard('fireAdmin')).agency;
  assert.equal(shown.members[created.uid].role, 'RESPONDER');
  assert.equal(shown.members[created.uid].teamId, 'team1');
  assert.equal(shown.members[created.uid].displayName, 'Fire Responder');
  assert.equal(shown.teams.team1.name, 'Team 1');
  await assert.rejects(s.service.createResponder('fireAdmin', 'BFP', { ...s.input, email: 'other@example.com', teamId: 'ghost' }), /Team does not belong/);

  await s.service.assignResponderTeam('fireAdmin', 'BFP', created.uid, { teamId: 'team2' });
  assert.equal(s.city().users[created.uid].teamId, 'team2');
  assert.equal(s.city().agency.BFP.members[created.uid].teamId, 'team2');
  await assert.rejects(s.service.assignResponderTeam('fireAdmin', 'BFP', created.uid, { teamId: 'ghost' }), /Team does not belong/);
  await assert.rejects(s.service.assignResponderTeam('policeAdmin', 'BFP', created.uid, { teamId: 'team2' }), /denied/);

  await s.service.assignResponderTeam('fireAdmin', 'BFP', created.uid, { teamId: null });
  assert.equal(s.city().users[created.uid].teamId, null);
  assert.equal(s.city().agency.BFP.members[created.uid].teamId, null);
});

test('agency revision marker is returned to agency admins and refused to unknown accounts', async () => {
  const s = await responderSetup();
  s.data.data_revision = 7;
  assert.deepEqual(await s.service.revision('fireAdmin'), { revision: 7 });
  await assert.rejects(s.service.revision('unknownUser'), /permission/);
});

test('responder deletion needs the typed email plus delete, stays inside the agency, and keeps the name for history', async () => {
  const s = await responderSetup();
  const created = await s.service.createResponder('fireAdmin', 'BFP', { ...s.input });
  await assert.rejects(s.service.deleteResponder('fireAdmin', 'BFP', created.uid, { confirmation: 'fire@example.com' }), /followed by "delete"/);
  await assert.rejects(s.service.deleteResponder('policeAdmin', 'BFP', created.uid, { confirmation: 'fire@example.comdelete' }), /denied/);
  await assert.rejects(s.service.deleteResponder('fireAdmin', 'BFP', 'fireAdmin', { confirmation: 'fire@example.comdelete' }), /own account/);
  await s.service.deleteResponder('fireAdmin', 'BFP', created.uid, { confirmation: 'fire@example.comdelete' });
  assert.equal(s.city().users[created.uid].active, false);
  assert.equal(s.city().users[created.uid].email, undefined);
  assert.equal(s.city().users[created.uid].displayName, 'Fire Responder');
  assert.equal(s.city().agency.BFP.members[created.uid], undefined);
  assert.equal(s.accounts.has(created.uid), false);
  assert.ok(Object.values(s.city().command_center.audit_logs).some(entry => entry.action === 'RESPONDER_DELETED' && entry.targetUid === created.uid));
});

test('advisories: drafts stay private, publishing copies to public_advisories, agencies stay in scope', async () => {
  const s = await responderSetup();
  s.city().users.command = { role: 'COMMAND_ADMIN', active: true };
  const draft = { title: 'Heavy rain warning', category: 'WARNING', severity: 'HIGH', agencyId: 'BFP', shortDescription: 'Rain expected.', fullMessage: 'Stay indoors.', actions: ['Avoid rivers.', ' '] };

  await assert.rejects(s.service.saveAdvisory('fireAdmin', { ...draft, title: '' }), /advisory title/);
  await assert.rejects(s.service.saveAdvisory('fireAdmin', { ...draft, agencyId: 'PNP' }), /own agency/);
  await assert.rejects(s.service.saveAdvisory('fireAdmin', { ...draft, area: 'Barangay X' }), /citywide or a specific/);
  const { id } = await s.service.saveAdvisory('fireAdmin', draft);
  const saved = s.city().advisories[id];
  assert.equal(saved.status, 'DRAFT'); assert.deepEqual(saved.actions, ['Avoid rivers.']); assert.equal(saved.agencyName, s.city().agency.BFP.profile.name);
  assert.equal(s.city().public_advisories, undefined);

  assert.ok((await s.service.listAdvisories('fireAdmin')).advisories[id]);
  assert.equal((await s.service.listAdvisories('policeAdmin')).advisories[id], undefined);
  assert.deepEqual((await s.service.listAdvisories('fireAdmin')).issuers.map(item => item.id), ['BFP']);
  assert.ok((await s.service.listAdvisories('command')).issuers.some(item => item.id === 'COMMAND_CENTER'));
  await assert.rejects(s.service.publishAdvisory('policeAdmin', id), /not found/);

  await s.service.saveAdvisory('fireAdmin', { ...draft, id, fullMessage: '' });
  await assert.rejects(s.service.publishAdvisory('fireAdmin', id), /full message/);
  await s.service.saveAdvisory('fireAdmin', { ...draft, id });
  await s.service.publishAdvisory('fireAdmin', id);
  assert.equal(s.city().advisories[id].status, 'PUBLISHED');
  const published = s.city().public_advisories[id];
  assert.equal(published.title, 'Heavy rain warning'); assert.equal(published.createdBy, undefined); assert.ok(published.issuedAt);
  // Published advisories can be edited; the citizen copy updates with publishing checks.
  await assert.rejects(s.service.saveAdvisory('fireAdmin', { ...draft, id, fullMessage: '' }), /full message/);
  assert.equal(s.city().public_advisories[id].fullMessage, 'Stay indoors.');
  const edited = await s.service.saveAdvisory('fireAdmin', { ...draft, id, title: 'Heavy rain warning (updated)' });
  assert.match(edited.message, /Citizens see the change/);
  assert.equal(s.city().advisories[id].status, 'PUBLISHED');
  assert.equal(s.city().public_advisories[id].title, 'Heavy rain warning (updated)');
  assert.equal(s.city().public_advisories[id].issuedAt, published.issuedAt);
  await assert.rejects(s.service.deleteAdvisory('fireAdmin', id), /Only drafts/);
  await assert.rejects(s.service.unarchiveAdvisory('fireAdmin', id), /Only archived/);

  await s.service.archiveAdvisory('command', id);
  assert.equal(s.city().advisories[id].status, 'ARCHIVED');
  assert.equal(s.city().public_advisories[id], undefined);
  await assert.rejects(s.service.saveAdvisory('fireAdmin', { ...draft, id }), /Unarchive/);

  // Unarchiving returns it to a draft; it stays out of the citizen app until republished.
  await assert.rejects(s.service.unarchiveAdvisory('policeAdmin', id), /not found/);
  await s.service.unarchiveAdvisory('fireAdmin', id);
  assert.equal(s.city().advisories[id].status, 'DRAFT');
  assert.equal(s.city().public_advisories[id], undefined);
  await s.service.publishAdvisory('fireAdmin', id);
  assert.equal(s.city().public_advisories[id].title, 'Heavy rain warning (updated)');
  assert.ok(Object.values(s.city().command_center.audit_logs).some(log => log.action === 'ADVISORY_UNARCHIVED' && log.resourceId === id));
  assert.ok(Object.values(s.city().command_center.audit_logs).some(log => log.action === 'ADVISORY_PUBLISHED' && log.resourceId === id));

  const other = await s.service.saveAdvisory('command', { title: 'Expired', agencyId: 'COMMAND_CENTER', shortDescription: 'x', fullMessage: 'y', actions: ['z'], expiresAt: 1 });
  await assert.rejects(s.service.publishAdvisory('command', other.id), /already passed/);
  await s.service.deleteAdvisory('command', other.id);
  assert.equal(s.city().advisories[other.id], undefined);
});

test('staff emergencies: created from a map click in the citizen incident shape, by allowed roles only', async () => {
  const s = await responderSetup();
  s.city().users.command = { role: 'COMMAND_ADMIN', active: true, displayName: 'Ops Desk' };
  s.city().users.responder = { role: 'RESPONDER', agencyId: 'BFP', active: true };
  const click = { type: 'FIRE', latitude: 17.41234567, longitude: 121.4441111 };

  await assert.rejects(s.service.createStaffIncident('responder', click), /administrator access/);
  await assert.rejects(s.service.createStaffIncident('command', { ...click, type: 'FLOOD' }), /type of emergency/);
  await assert.rejects(s.service.createStaffIncident('command', { ...click, latitude: 51.5 }), /Click the map/);
  await assert.rejects(s.service.createStaffIncident('command', { ...click, reporterPhone: 'call me' }), /phone number/);

  s.city().agency.BFP.profile.emergencyTypes = ['FIRE'];
  s.city().agency.BFP.stations.fireStation = { name: 'Fire station', latitude: 17.4125, longitude: 121.4440 };
  s.city().agency.BFP.teams = { fireTeam: { active: true, status: 'AVAILABLE', stationId: 'fireStation' } };
  const fromCommand = await s.service.createStaffIncident('command', { ...click, description: '  Smoke from a house ', reporterName: ' Juan ', reporterPhone: '0917 123 4567' });
  const incident = s.data.incidents[fromCommand.id];
  assert.equal(incident.status, 'RECEIVED'); assert.equal(incident.priority, 'HIGH'); assert.equal(incident.isSimulation, false);
  assert.equal(incident.leadAgencyId, 'BFP');
  assert.deepEqual(incident.recommendedAgencies, { BFP: true });
  assert.equal(incident.recommendedStations.BFP, 'fireStation');
  assert.equal(incident.owner, 'BFP');
  assert.equal(incident.routingMethod, 'NEAREST_STATION');
  assert.equal(incident.location.latitude, 17.412346); assert.equal(incident.location.longitude, 121.444111);
  assert.equal(incident.description, 'Smoke from a house');
  assert.equal(incident.reporterName, 'Juan'); assert.equal(incident.reporterPhone, '0917 123 4567');
  assert.equal(incident.createdBy, 'command'); assert.equal(incident.creationSource, 'STAFF_MAP');
  assert.equal(Object.values(s.data.incident_events[fromCommand.id])[0].type, 'INCIDENT_CREATED');
  assert.ok(Object.values(s.city().command_center.audit_logs).some(log => log.action === 'INCIDENT_CREATED_BY_STAFF' && log.resourceId === fromCommand.id));

  assert.equal(incident.location.address, 'Pinned on map (17.41235, 121.44411)');
  await assert.rejects(s.service.createStaffIncident('command', { ...click, barangay: { name: 'Elsewhere', pcode: 'PH0000000001' } }), /Invalid barangay/);
  const withBarangay = await s.service.createStaffIncident('command', { ...click, barangay: { name: ' Bulanao ', pcode: 'PH1403213009' } });
  const located = s.data.incidents[withBarangay.id].location;
  assert.equal(located.address, 'Brgy. Bulanao · pinned on map (17.41235, 121.44411)');
  assert.equal(located.barangay, 'Bulanao'); assert.equal(located.barangayCode, 'PH1403213009');

  const fromAgency = await s.service.createStaffIncident('policeAdmin', { type: 'POLICE', latitude: 17.4, longitude: 121.45 });
  const agencyIncident = s.data.incidents[fromAgency.id];
  assert.equal(agencyIncident.leadAgencyId, 'PNP'); assert.equal(agencyIncident.recommendedAgencies.PNP, true);
  assert.equal(agencyIncident.description, ''); assert.equal(agencyIncident.reporterName, undefined);
});

test('advisory affected area: citywide or a map pin with radius and name', async () => {
  const s = await responderSetup();
  const draft = { title: 'Landslide', agencyId: 'BFP', shortDescription: 's', fullMessage: 'f', actions: ['a'] };
  const pin = { latitude: 17.41234567, longitude: 121.4441111, radiusMeters: 500, label: '  Brgy. Bulanao, near the creek ' };

  const citywide = await s.service.saveAdvisory('fireAdmin', { ...draft, location: pin });
  assert.equal(s.city().advisories[citywide.id].location, null);
  await assert.rejects(s.service.saveAdvisory('fireAdmin', { ...draft, area: 'SPECIFIC', location: { ...pin, latitude: 51.5 } }), /on the map/);
  await assert.rejects(s.service.saveAdvisory('fireAdmin', { ...draft, area: 'SPECIFIC', location: { ...pin, radiusMeters: 123 } }), /radius/);

  const { id } = await s.service.saveAdvisory('fireAdmin', { ...draft, area: 'SPECIFIC' });
  assert.equal(s.city().advisories[id].location, null);
  await assert.rejects(s.service.publishAdvisory('fireAdmin', id), /on the map/);
  await s.service.saveAdvisory('fireAdmin', { ...draft, id, area: 'SPECIFIC', location: { ...pin, label: '' } });
  await assert.rejects(s.service.publishAdvisory('fireAdmin', id), /affected area name/);
  await s.service.saveAdvisory('fireAdmin', { ...draft, id, area: 'SPECIFIC', location: pin });
  await s.service.publishAdvisory('fireAdmin', id);
  assert.deepEqual(s.city().public_advisories[id].location, { latitude: 17.412346, longitude: 121.444111, radiusMeters: 500, label: 'Brgy. Bulanao, near the creek' });
  assert.equal(s.city().public_advisories[id].area, 'SPECIFIC');
});

test('advisory cover images: validated, editable until archived, replaced cleanly and kept in the citizen copy', async () => {
  const s = await responderSetup();
  s.city().users.command = { role: 'COMMAND_ADMIN', active: true };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]).toString('base64');
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]).toString('base64');
  const { id } = await s.service.saveAdvisory('fireAdmin', { title: 'Landslide warning', agencyId: 'BFP', shortDescription: 's', fullMessage: 'f', actions: ['a'] });

  await assert.rejects(s.service.uploadAdvisoryImage('fireAdmin', id, { contentType: 'image/gif', data: png }), /JPG, PNG or WebP/);
  await assert.rejects(s.service.uploadAdvisoryImage('fireAdmin', id, { contentType: 'image/jpeg', data: png }), /does not match/);
  await assert.rejects(s.service.uploadAdvisoryImage('fireAdmin', id, { contentType: 'image/png', data: 'A'.repeat(4.3 * 1024 * 1024) }), /3 MB/);
  await assert.rejects(s.service.uploadAdvisoryImage('policeAdmin', id, { contentType: 'image/png', data: png }), /not found/);

  const first = await s.service.uploadAdvisoryImage('fireAdmin', id, { contentType: 'image/png', data: png });
  const firstPath = s.city().advisories[id].image.path;
  assert.equal(first.imageUrl, `https://files.test/${firstPath}`);
  assert.ok(s.stored.has(firstPath));
  s.tick();
  await s.service.uploadAdvisoryImage('fireAdmin', id, { contentType: 'image/jpeg', data: jpg });
  const secondPath = s.city().advisories[id].image.path;
  assert.notEqual(secondPath, firstPath); assert.equal(s.stored.has(firstPath), false); assert.ok(secondPath.endsWith('.jpg'));

  await s.service.saveAdvisory('fireAdmin', { id, title: 'Landslide warning (updated)', agencyId: 'BFP', shortDescription: 's', fullMessage: 'f', actions: ['a'] });
  assert.equal(s.city().advisories[id].image.path, secondPath);
  await s.service.publishAdvisory('fireAdmin', id);
  assert.equal(s.city().public_advisories[id].imageUrl, `https://files.test/${secondPath}`);
  assert.equal(s.city().public_advisories[id].image, undefined);
  // A published advisory's image can change; the citizen copy follows.
  s.tick();
  await s.service.uploadAdvisoryImage('fireAdmin', id, { contentType: 'image/png', data: png });
  const livePath = s.city().advisories[id].image.path;
  assert.equal(s.city().public_advisories[id].imageUrl, `https://files.test/${livePath}`);
  assert.equal(s.stored.has(secondPath), false);
  await s.service.removeAdvisoryImage('fireAdmin', id);
  assert.equal(s.city().public_advisories[id].imageUrl ?? null, null);
  await s.service.archiveAdvisory('fireAdmin', id);
  await assert.rejects(s.service.uploadAdvisoryImage('fireAdmin', id, { contentType: 'image/png', data: png }), /drafts and published/);
  await assert.rejects(s.service.removeAdvisoryImage('fireAdmin', id), /drafts and published/);

  const other = await s.service.saveAdvisory('command', { title: 'Temp', agencyId: 'COMMAND_CENTER' });
  await s.service.uploadAdvisoryImage('command', other.id, { contentType: 'image/png', data: png });
  const otherPath = s.city().advisories[other.id].image.path;
  await s.service.removeAdvisoryImage('command', other.id);
  assert.equal(s.city().advisories[other.id].image, null); assert.equal(s.stored.has(otherPath), false);
  await s.service.uploadAdvisoryImage('command', other.id, { contentType: 'image/png', data: png });
  const finalPath = s.city().advisories[other.id].image.path;
  await s.service.deleteAdvisory('command', other.id);
  assert.equal(s.stored.has(finalPath), false);
});

test('an agency that is not recommended can dispatch its own team once it has acknowledged the incident', async () => {
  const s = await responderSetup();
  s.data.incidents = { other: { status: 'VERIFIED', version: 1, leadAgencyId: 'PNP', recommendedAgencies: { PNP: true } } };
  s.data.agencies = { BFP: { active: true }, PNP: { active: true } };
  s.data.teams = { fireTeam: { agencyId: 'BFP', name: 'Fire team', stationId: 'fireStation', status: 'AVAILABLE', active: true } };
  await assert.rejects(s.service.agencyDispatchCommand('fireAdmin', { action: 'dispatch', incidentId: 'other', teamId: 'fireTeam', expectedVersion: 1 }), /must acknowledge/);
  await s.service.agencyDispatchCommand('fireAdmin', { action: 'acknowledge', incidentId: 'other' });
  await s.service.agencyDispatchCommand('fireAdmin', { action: 'dispatch', incidentId: 'other', teamId: 'fireTeam', expectedVersion: s.data.incidents.other.version });
  assert.equal(s.data.teams.fireTeam.status, 'DISPATCHED');
});

test('the monthly summary counts road crashes by month, type, casualties, severity, licence and barangay', async () => {
  const s = await responderSetup();
  s.city().users.command = { role: 'COMMAND_ADMIN', active: true };
  s.city().command_center = { response_reports: {
    r1: { status: 'APPROVED', agencyId: 'BFP', DATE: '2026-08-05', TIME_CALL: '12:40', emergencyType: 'ROAD_ACCIDENT', VEHICLE_TYPE: 'MOTORCYCLE', CRASH_TYPE: 'SELF_ACCIDENT', SCENE_LOCATION: 'Brgy. Magsaysay, National Road, Tabuk City', patients: [{ PATIENT_GENDER_spinner: 'Male', VICTIM_ROLE: 'DRIVER', LICENSED: 'UNLICENSED', SEVERITY: 'CRITICAL' }] },
    r2: { status: 'APPROVED', agencyId: 'BFP', DATE: '2026-08-20', TIME_CALL: '18:10', emergencyType: 'ROAD_ACCIDENT', VEHICLE_TYPE: 'MOTORCYCLE', CRASH_TYPE: 'COLLISION', SCENE_LOCATION: 'Brgy. Casigayan, Tabuk City', patients: [{ PATIENT_GENDER_spinner: 'Male', VICTIM_ROLE: 'DRIVER', LICENSED: 'UNLICENSED', SEVERITY: 'MODERATE' }] },
    r3: { status: 'APPROVED', agencyId: 'PNP', DATE: '2026-08-21', TIME_CALL: '10:00', emergencyType: 'FIRE', patients: [] },
    r4: { status: 'RETURNED', agencyId: 'BFP', DATE: '2026-08-22', TIME_CALL: '10:00', emergencyType: 'ROAD_ACCIDENT', patients: [{ PATIENT_GENDER_spinner: 'Female' }] },
  } };
  const summary = await s.service.responseSummary('command', { month: '2026-08', emergencyType: 'ROAD_ACCIDENT' });
  assert.equal(summary.totalIncidents, 2);
  assert.deepEqual(summary.byCrashType, { SELF_ACCIDENT: 1, COLLISION: 1, NOT_RECORDED: 0 });
  // Without a type the summary covers every incident type (the fire report counts too).
  assert.equal((await s.service.responseSummary('command', { month: '2026-08' })).totalIncidents, 3);
  assert.equal(summary.byVehicleType.MOTORCYCLE, 2);
  assert.deepEqual(summary.casualties, { total: 2, male: 2, female: 0, unknown: 0 });
  assert.equal(summary.bySeverity.CRITICAL, 1);
  assert.equal(summary.bySeverity.MODERATE, 1);
  assert.equal(summary.byLicence.UNLICENSED, 2);
  assert.equal(summary.byVictimRole.DRIVER, 2);
  assert.deepEqual(summary.peakWindow, { from: '12:00', to: '16:00', count: 1 });
  assert.deepEqual(summary.byBarangay, [{ name: 'Casigayan', count: 1 }, { name: 'Magsaysay', count: 1 }]);
  // Agency administrators see their own agency's reports only; responders see no summary.
  assert.equal((await s.service.responseSummary('fireAdmin', { month: '2026-08' })).totalIncidents, 2);
  await assert.rejects(s.service.responseSummary('responder', { month: '2026-08' }), /staff account required|Administrator access/);
  await assert.rejects(s.service.responseSummary('command', { month: '2026-13' }), /Choose a month/);
});
