import { fail } from '../../utils/http-error.js';

const roles = ['SYSTEM_ADMIN', 'COMMAND_ADMIN', 'AGENCY_ADMIN', 'RESPONDER'];
// Only used to transition previously registered accounts and invitations.
const retiredRoleTargets = Object.assign(Object.create(null), { COMMAND_DISPATCHER: 'COMMAND_ADMIN', AGENCY_DISPATCHER: 'AGENCY_ADMIN' });
const str = (v, name, required = true) => {
  if (typeof v !== 'string' || v.length > 500 || (required && !v.trim())) fail(`Invalid ${name}.`);
  return v.trim();
};
const key = (v, name = 'identifier') => {
  v = str(v, name);
  if (/[.#$\[\]/\u0000-\u001f\u007f]/.test(v)) fail(`Invalid ${name}.`);
  return v;
};
const code = v => {
  v = str(v, 'agency ID').toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(v)) fail('Agency ID must contain 2–32 letters, numbers or underscores.');
  if (v === 'CDRRMC') fail('Use CDRRMO. Review and migrate legacy CDRRMC records first.');
  return v;
};
const email = v => {
  v = str(v, 'email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail('Invalid email.');
  return v;
};
// A public emergency hotline: a short code (911, 160), a landline such as (074) 627-1234,
// a mobile number such as 0917 123 4567, or a toll-free number.
// Empty means no hotline. Returns the number as typed, with spaces tidied.
const hotline = value => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > 40) fail('Invalid hotline.');
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) return '';
  const digits = text.replace(/\D/g, '');
  if (!/^\+?[\d\s().-]+$/.test(text) || digits.length < 3 || digits.length > 15) fail('Enter a hotline such as 911, (074) 627-1234 or 0917 123 4567.');
  return text;
};
function stationInput(input) {
  if (input.latitude === '' || input.longitude === '' || input.latitude == null || input.longitude == null
    || !Number.isFinite(Number(input.latitude)) || !Number.isFinite(Number(input.longitude))
    || Math.abs(Number(input.latitude)) > 90 || Math.abs(Number(input.longitude)) > 180) fail('Valid latitude and longitude are required.');
  // Only a request that sends a hotline changes it, so other station edits keep the saved one.
  return { name: str(input.name, 'station name'), location: str(input.location, 'station location'), latitude: Number(input.latitude), longitude: Number(input.longitude),
    ...(input.hotline !== undefined ? { hotline: hotline(input.hotline) } : {}) };
}

// Personal details kept on a responder's profile. Phone is required; the rest is optional.
const PH_MOBILE = /^(?:\+63|0)9\d{9}$/;
const phone = (value, name, required) => {
  const raw = typeof value === 'string' ? value.replace(/[\s-]/g, '') : '';
  if (!raw) { if (required) fail(`Enter the ${name}.`); return ''; }
  if (!PH_MOBILE.test(raw)) fail(`Enter a valid Philippine mobile number for the ${name} (09XXXXXXXXX or +639XXXXXXXXX).`);
  return raw.startsWith('+63') ? `0${raw.slice(3)}` : raw;
};
function responderProfileInput(input, today = new Date()) {
  if (!input || typeof input !== 'object') fail('Responder details are required.');
  const optional = (value, name, max = 500) => {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string' || value.length > max) fail(`Invalid ${name}.`);
    return value.trim();
  };
  const birthdate = optional(input.birthdate, 'birthdate', 10);
  if (birthdate) {
    const parsed = new Date(`${birthdate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birthdate) fail('Invalid birthdate.');
    const age = (today.getTime() - parsed.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (age < 16 || age > 100) fail('Birthdate must make the responder 16 to 100 years old.');
  }
  const sex = optional(input.sex, 'sex', 10);
  if (sex && !['MALE', 'FEMALE'].includes(sex)) fail('Invalid sex.');
  return {
    phoneNumber: phone(input.phoneNumber, 'phone number', true),
    residentialAddress: optional(input.residentialAddress, 'residential address'),
    birthdate,
    sex,
    emergencyContactName: optional(input.emergencyContactName, 'emergency contact name', 200),
    emergencyContactPhone: phone(input.emergencyContactPhone, 'emergency contact phone', false),
  };
}
function responderInput(input) {
  if (!input || typeof input !== 'object') fail('Responder details are required.');
  if (input.role !== undefined && input.role !== 'RESPONDER') fail('Only responder accounts can be registered.');
  if (input.active !== undefined && typeof input.active !== 'boolean') fail('Account status must be a boolean.');
  if (typeof input.password !== 'string' || input.password.length < 6 || input.password.length > 128) {
    fail('Password must contain 6–128 characters.');
  }
  return {
    displayName: str(input.displayName, 'full name'),
    email: email(input.email),
    stationId: input.stationId ? key(input.stationId, 'station') : null,
    active: input.active !== false,
  };
}

function stationMapRecords(legacy = {}, shared = {}, agencies = {}, agencyScope = null) {
  const merged = { ...legacy, ...shared };
  for (const [agencyId, agency] of Object.entries(agencies || {})) {
    for (const [stationId, value] of Object.entries(agency?.stations || {})) {
      const station = value && typeof value === 'object' ? value : merged[stationId];
      if (station && typeof station === 'object') merged[stationId] = { ...station, agencyId };
    }
  }
  const coordinate = value => typeof value === 'number' && Number.isFinite(value) ? value
    : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined;
  return Object.fromEntries(Object.entries(merged).filter(([, station]) => station && typeof station === 'object'
    && (!agencyScope || station.agencyId === agencyScope)
    && station.active !== false && agencies?.[station.agencyId]?.profile?.active !== false).map(([id, station]) => {
    const nested = station.location && typeof station.location === 'object' ? station.location : {};
    const latitude = coordinate(nested.latitude) ?? coordinate(station.latitude);
    const longitude = coordinate(nested.longitude) ?? coordinate(station.longitude);
    const isSimulation = station.isSimulation === true || station.isSimulated === true || nested.isSimulation === true || nested.isSimulated === true || nested.source === 'SIMULATION_ONLY';
    return [id, { ...station, id, stationId: id, latitude, longitude, isSimulation,
      location: { ...nested, latitude, longitude, address: typeof station.location === 'string' ? station.location : nested.address || '', displayLabel: nested.displayLabel || station.name || id } }];
  }));
}

function requireAgencyDispatch(state, uid) {
  const city = state.server?.['City of Tabuk'];
  const user = city?.users?.[uid] ?? state.users?.[uid];
  if (user?.role !== 'AGENCY_ADMIN' || user.active !== true || user.authProvisioned !== true
    || !user.agencyId || city?.agency?.[user.agencyId]?.profile?.active !== true) fail('Active agency administrator required.', 403);
  return user;
}
function agencyIncident(state, user, incidentId) {
  const incident = state.incidents?.[incidentId];
  return incident && (incident.leadAgencyId === user.agencyId || incident.recommendedAgencies?.[user.agencyId] === true
    || Object.values(state.dispatch_assignments || {}).some(item => item.incidentId === incidentId && item.agencyId === user.agencyId));
}
// Response reports may be filed by any agency involved in the incident: the lead or a
// recommended agency, an agency whose staff acknowledged (responded to) it, or one whose team
// or responders were dispatched to it, including dispatches made by the Command Center.
const INVOLVEMENT_EVENTS = new Set(['INCIDENT_ACKNOWLEDGED', 'TEAM_DISPATCHED']);
function agencyInvolvedInIncident(state, agencyId, incidentId, incident, assignments = {}) {
  if (!agencyId || !incident) return false;
  const city = state.server?.['City of Tabuk'] || {};
  const agencyOfUser = uid => (city.users?.[uid] ?? state.users?.[uid])?.agencyId;
  if (incident.leadAgencyId === agencyId || incident.recommendedAgencies?.[agencyId] === true) return true;
  if (incident.acknowledgedByAgencyId === agencyId || Boolean(incident.agencyAcknowledgements?.[agencyId])) return true;
  if (incident.acknowledgedBy && agencyOfUser(incident.acknowledgedBy) === agencyId) return true;
  if (state.agency_incidents?.[agencyId]?.[incidentId] === true) return true;
  const events = { ...state.incident_events?.[incidentId], ...city.command_center?.incident_events?.[incidentId] };
  if (Object.values(events).some(event => INVOLVEMENT_EVENTS.has(event?.type) && event.isSimulation !== true
    && (event.agencyId === agencyId || agencyOfUser(event.actorId) === agencyId))) return true;
  const teamAgency = teamId => state.teams?.[teamId]?.agencyId || city.teams?.[teamId]?.agencyId
    || (city.agency?.[agencyId]?.teams?.[teamId] ? agencyId : undefined);
  return Object.values(assignments).some(item => item?.incidentId === incidentId && item.isSimulation !== true
    && (item.agencyId === agencyId || teamAgency(item.teamId) === agencyId));
}
function applyAgencyCommand(state, uid, input, ids, timestamp) {
  const user = requireAgencyDispatch(state, uid);
  const incidentId = key(input.incidentId, 'incident ID');
  if (input.action === 'dispatch' && !agencyIncident(state, user, incidentId)) fail('Incident is outside your agency.', 403);
  const incident = state.incidents?.[incidentId];
  if (!incident) fail('Incident no longer exists.');
  if (['RESOLVED', 'CANCELLED', 'CLOSED'].includes(incident.status)) fail('Incident is already closed.');
  const activeAssignment = item => item.status && !['COMPLETED', 'CANCELLED', 'REJECTED', 'DECLINED', 'EXPIRED'].includes(item.status);
  const simulation = incident.isSimulation === true;
  const agencyName = state.server['City of Tabuk'].agency[user.agencyId].profile.name || user.agencyId;
  const attribution = { agencyId: user.agencyId, agencyName };
  if (input.action === 'acknowledge') {
    if (incident.agencyAcknowledgements?.[user.agencyId] || incident.acknowledgedByAgencyId === user.agencyId) return state;
    incident.agencyAcknowledgements ||= {};
    incident.agencyAcknowledgements[user.agencyId] = { ...attribution, acknowledgedAt: timestamp, acknowledgedBy: uid };
    if (!incident.acknowledgedAt) {
      incident.acknowledgedAt = timestamp; incident.acknowledgedBy = uid;
      incident.acknowledgedByAgencyId = user.agencyId; incident.acknowledgedByAgencyName = agencyName;
    }
  } else {
    if ((incident.version || 0) !== input.expectedVersion) fail('Incident changed. Refresh and review its latest details.', 409);
    if (input.action === 'dispatch') {
      if (!incident.agencyAcknowledgements?.[user.agencyId] && incident.acknowledgedByAgencyId !== user.agencyId) fail('Your agency must acknowledge this incident before dispatching a team.', 403);
      const teamId = key(input.teamId, 'team ID'); const team = state.teams?.[teamId];
      if (!team || team.agencyId !== user.agencyId) fail('You may dispatch teams only from your agency.', 403);
      if (team.active !== true) fail('Team is inactive.');
      if (Boolean(team.isSimulation) !== simulation) fail('Simulation and live operations must use separate teams.');
      // Readiness alone decides dispatch; responder GPS location is not required.
      if (team.status !== 'AVAILABLE' || Object.values(state.dispatch_assignments || {}).some(item => item.teamId === teamId && activeAssignment(item))) fail('Team is unavailable or already assigned.');
      state.dispatch_assignments ||= {};
      state.dispatch_assignments[ids.assignmentId] = { incidentId, teamId, agencyId: user.agencyId, agencyName, status: 'PENDING_ACKNOWLEDGMENT', assignedBy: uid, assignedAt: timestamp, isSimulation: simulation };
      for (const [collection, parent, child] of [['incident_assignments', incidentId, ids.assignmentId], ['team_assignments', teamId, ids.assignmentId], ['agency_incidents', user.agencyId, incidentId]]) {
        state[collection] ||= {}; state[collection][parent] ||= {}; state[collection][parent][child] = true;
      }
      state.notification_jobs ||= {};
      state.notification_jobs[ids.jobId] = { incidentId, assignmentId: ids.assignmentId, targetType: 'TEAM', targetId: teamId, status: simulation ? 'SIMULATED' : 'PENDING', attempts: 0, createdAt: timestamp, isSimulation: simulation };
      team.status = 'DISPATCHED';
      if (['RECEIVED', 'VERIFIED'].includes(incident.status)) incident.status = 'DISPATCHED';
    } else if (input.action === 'close') {
      if (input.status === 'RESOLVED') {
        if (!incident.agencyAcknowledgements?.[user.agencyId] && incident.acknowledgedByAgencyId !== user.agencyId) fail('Your agency must acknowledge this incident before resolving it.', 403);
      } else if (incident.leadAgencyId !== user.agencyId) fail('Only the lead agency can cancel this incident.', 403);
      if (!['RESOLVED', 'CANCELLED'].includes(input.status)) fail('Invalid closing status.');
      for (const assignment of Object.values(state.dispatch_assignments || {})) {
        if (assignment.incidentId !== incidentId || !activeAssignment(assignment)) continue;
        assignment.status = input.status === 'RESOLVED' ? 'COMPLETED' : 'CANCELLED'; assignment.completedAt = timestamp;
        const team = state.teams?.[assignment.teamId];
        if (team?.active === true && (!simulation || team.isSimulation) && ['DISPATCHED', 'BUSY', 'ON_SCENE', 'EN_ROUTE', 'RESPONDING'].includes(team.status)
          && !Object.values(state.dispatch_assignments).some(other => other.teamId === assignment.teamId && activeAssignment(other))) team.status = 'AVAILABLE';
      }
      for (const job of Object.values(state.notification_jobs || {})) if (job.incidentId === incidentId && job.status === 'PENDING') { job.status = 'CANCELLED'; job.cancelledAt = timestamp; }
      incident.status = input.status;
      incident.closedBy = uid; incident.closedAt = timestamp;
      incident.closedByAgencyId = user.agencyId; incident.closedByAgencyName = agencyName;
    } else fail('Unsupported agency command.');
  }
  incident.version = (incident.version || 0) + 1; incident.updatedAt = timestamp;
  if (input.action === 'close') {
    const commandCenter = state.server['City of Tabuk'].command_center;
    const closure = { status: incident.status, closedBy: uid, closedAt: timestamp, closedByAgencyId: user.agencyId, closedByAgencyName: agencyName, version: incident.version, updatedAt: timestamp };
    if (commandCenter?.incidents?.[incidentId]) Object.assign(commandCenter.incidents[incidentId], closure);
    for (const [feedId, entry] of Object.entries(commandCenter?.incident_feed || {})) {
      if (entry && typeof entry === 'object' && (entry.incidentId || feedId) === incidentId) Object.assign(entry, closure);
    }
  }
  const type = input.action === 'dispatch' ? 'TEAM_DISPATCHED' : input.action === 'close' ? `INCIDENT_${input.status}` : 'INCIDENT_ACKNOWLEDGED';
  const detail = input.action === 'dispatch' ? { assignmentId: ids.assignmentId, teamId: input.teamId } : {};
  state.incident_events ||= {}; state.incident_events[incidentId] ||= {};
  state.incident_events[incidentId][ids.eventId] = { type, actorId: uid, timestamp, isSimulation: simulation, ...attribution, ...detail };
  state.audit_logs ||= {}; state.audit_logs[ids.auditId] = { action: type, actorId: uid, resourceId: incidentId, timestamp, isSimulation: simulation, ...attribution, ...detail };
  return state;
}
export { roles, retiredRoleTargets, fail, str, key, code, email, hotline, stationInput, responderInput, responderProfileInput, stationMapRecords, requireAgencyDispatch, agencyIncident, agencyInvolvedInIncident, applyAgencyCommand };
