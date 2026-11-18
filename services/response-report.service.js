import { CITY } from '../config/data-paths.js';
import { fail, key, agencyInvolvedInIncident } from './rules/agency.rules.js';

// Structured answers for road-crash style reporting. Empty means not recorded; older reports have none.
const VEHICLE_TYPES = ['MOTORCYCLE', 'CAR', 'TRICYCLE', 'TRUCK', 'BUS', 'OTHER'];
const CRASH_TYPES = ['SELF_ACCIDENT', 'COLLISION'];
const VICTIM_ROLES = ['DRIVER', 'PASSENGER', 'PEDESTRIAN', 'OTHER'];
const LICENCE_STATUSES = ['LICENSED', 'UNLICENSED', 'NOT_APPLICABLE'];
const SEVERITIES = ['CRITICAL', 'MODERATE', 'MINOR'];
function enumValue(value, allowed, label) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !allowed.includes(value)) fail(`Invalid ${label}.`);
  return value;
}
// Philippine time is UTC+8; summaries group by Philippine month and hour.
const PH_OFFSET_MS = 8 * 60 * 60 * 1000;

function createResponseReports({ repo, id, now }) {
  const cityOf = state => state.server?.['City of Tabuk'] || {};
  const operator = (state, uid) => {
    const city = cityOf(state);
    const user = city.users?.[uid] ?? state.users?.[uid];
    if (user?.active !== true || !['RESPONDER', 'AGENCY_ADMIN', 'COMMAND_ADMIN', 'SYSTEM_ADMIN'].includes(user.role)) fail('Active ERA staff account required.', 403);
    if (['RESPONDER', 'AGENCY_ADMIN'].includes(user.role)
      && (!user.agencyId || city.agency?.[user.agencyId]?.profile?.active !== true
        || (user.role === 'AGENCY_ADMIN' && user.authProvisioned !== true))) fail('Active agency membership required.', 403);
    return user;
  };
  const assignmentsOf = state => ({ ...state.dispatch_assignments, ...cityOf(state).command_center?.dispatch_assignments });
  const reportsOf = state => cityOf(state).command_center?.response_reports || {};
  const incidentsOf = state => ({ ...state.incidents, ...cityOf(state).command_center?.incidents });
  const agencyIncident = (state, user, incidentId, incident) => agencyInvolvedInIncident(state, user.agencyId, incidentId, incident, assignmentsOf(state));
  const text = (value, label, required = true) => {
    if (typeof value !== 'string' || value.length > 2000 || (required && !value.trim())) fail(`Invalid ${label}.`);
    return value.trim();
  };
  const clean = input => {
    if (Object.hasOwn(input, 'TIME_CALL')) {
      const result = { schemaVersion: 2 };
      for (const field of ['NAME_OF_CALLER', 'CONCERN', 'SCENE_LOCATION', 'AMBULANCE', 'TEAM']) result[field] = text(input[field], field);
      result.TAG = text(input.TAG ?? '', 'TAG', false);
      result.VEHICLE_TYPE = enumValue(input.VEHICLE_TYPE, VEHICLE_TYPES, 'vehicle type');
      result.CRASH_TYPE = enumValue(input.CRASH_TYPE, CRASH_TYPES, 'crash type');
      if (typeof input.TIME_CALL !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.TIME_CALL)) fail('Invalid Call Time.');
      if (typeof input.DATE !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.DATE) || !Number.isFinite(Date.parse(input.DATE)) || new Date(input.DATE).toISOString().slice(0, 10) !== input.DATE) fail('Invalid Date.');
      result.TIME_CALL = input.TIME_CALL; result.DATE = input.DATE;
      if (typeof input.TIME_ARRIVAL !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.TIME_ARRIVAL)) fail('Invalid Arrival Time.');
      result.TIME_ARRIVAL = input.TIME_ARRIVAL;
      if (!Number.isInteger(input.CASUALTY) || input.CASUALTY < 0 || input.CASUALTY > 10000) fail('Invalid Number of Casualties.');
      result.CASUALTY = input.CASUALTY;
      if (!Array.isArray(input.patients) || input.patients.length > 100 || input.patients.length > input.CASUALTY) fail('Invalid patient list.');
      result.patients = input.patients.map(patient => {
        const entry = {};
        for (const field of ['Firstname', 'Lastname', 'PATIENT_ADDRESS', 'PATIENT_STATUS', 'PATIENT_INJURY', 'PATIENT_GENDER_spinner']) entry[field] = text(patient[field], field);
        for (const field of ['PATIENT_RELIGION', 'PATIENT_CIVIL_STATUS_spinner']) entry[field] = text(patient[field] ?? '', field, false);
        if (patient.PATIENT_AGE !== null && (!Number.isInteger(patient.PATIENT_AGE) || patient.PATIENT_AGE < 0 || patient.PATIENT_AGE > 130)) fail('Invalid patient age.');
        entry.PATIENT_AGE = patient.PATIENT_AGE;
        entry.VICTIM_ROLE = enumValue(patient.VICTIM_ROLE, VICTIM_ROLES, 'victim role');
        entry.LICENSED = enumValue(patient.LICENSED, LICENCE_STATUSES, 'licence status');
        entry.SEVERITY = enumValue(patient.SEVERITY, SEVERITIES, 'injury severity');
        return entry;
      });
      return result;
    }
    const result = {};
    for (const field of ['vehicleUsed', 'sceneAssessment', 'actionsTaken', 'assistanceProvided', 'incidentOutcome', 'respondingPersonnel']) result[field] = text(input[field], field);
    for (const field of ['hospitalDestination', 'additionalRemarks']) result[field] = text(input[field] ?? '', field, false);
    result.vehicleType = enumValue(input.vehicleType, VEHICLE_TYPES, 'vehicle type');
    result.crashType = enumValue(input.crashType, CRASH_TYPES, 'crash type');
    for (const field of ['callTime', 'dispatchTime', 'arrivalTime', 'completionTime']) {
      if (typeof input[field] !== 'number' || !Number.isFinite(input[field]) || input[field] <= 0) fail(`Invalid ${field}.`);
      result[field] = input[field];
    }
    if (result.callTime > result.dispatchTime || result.dispatchTime > result.arrivalTime || result.arrivalTime > result.completionTime) fail('Response times must follow call, dispatch, arrival, and completion order.');
    if (!Number.isInteger(input.numberOfCasualties) || input.numberOfCasualties < 0 || input.numberOfCasualties > 10000) fail('Invalid number of casualties.');
    result.numberOfCasualties = input.numberOfCasualties;
    if (!Array.isArray(input.patients) || input.patients.length > 100 || input.patients.length > result.numberOfCasualties) fail('Invalid patient list.');
    result.patients = input.patients.map(patient => {
      const entry = {};
      for (const field of ['name', 'gender', 'address', 'injury', 'status']) entry[field] = text(patient[field], `patient ${field}`);
      entry.triageTag = text(patient.triageTag ?? '', 'triage tag', false);
      if (patient.age !== null && (!Number.isInteger(patient.age) || patient.age < 0 || patient.age > 130)) fail('Invalid patient age.');
      entry.age = patient.age;
      entry.victimRole = enumValue(patient.victimRole, VICTIM_ROLES, 'victim role');
      entry.licensed = enumValue(patient.licensed, LICENCE_STATUSES, 'licence status');
      entry.severity = enumValue(patient.severity, SEVERITIES, 'injury severity');
      return entry;
    });
    if (!Array.isArray(input.supportingPhotos) || input.supportingPhotos.length > 10) fail('At most ten supporting photos are allowed.');
    result.supportingPhotos = input.supportingPhotos.map(value => {
      const url = text(value, 'photo URL');
      try { if (new URL(url).protocol !== 'https:') fail('Photos require HTTPS URLs.'); } catch { fail('Photos require valid HTTPS URLs.'); }
      return url;
    });
    return result;
  };
  return {
    async responseReportData(uid) {
      const state = await repo.read('/') || {}; const user = operator(state, uid); const city = cityOf(state);
      const responder = user.role === 'RESPONDER';
      const scoped = ['RESPONDER', 'AGENCY_ADMIN'].includes(user.role);
      const assignments = Object.fromEntries(Object.entries(assignmentsOf(state)).filter(([, item]) => item && item.isSimulation !== true
        && (!scoped || item.agencyId === user.agencyId)
        && (!responder || (user.teamId && item.teamId === user.teamId))));
      const incidentIds = new Set(Object.values(assignments).map(item => item.incidentId));
      const incidents = Object.fromEntries(Object.entries(incidentsOf(state)).filter(([incidentId, item]) => item && item.isSimulation !== true
        && (user.role === 'AGENCY_ADMIN' ? agencyIncident(state, user, incidentId, item) : incidentIds.has(incidentId)))
        .map(([incidentId, item]) => [incidentId, { type: item.type || item.emergencyType || '', createdAt: item.createdAt || null, location: item.location?.address || item.locationName || '', description: item.description || '', reporterName: item.reporterName || '' }]));
      const reports = Object.fromEntries(Object.entries(city.command_center?.response_reports || {}).filter(([, report]) => report
        && (!scoped || report.agencyId === user.agencyId) && (!responder || report.submittedBy === uid)));
      const teams = { ...state.teams };
      for (const [agencyId, agency] of Object.entries(city.agency || {})) for (const [teamId, team] of Object.entries(agency.teams || {})) {
        if (team && typeof team === 'object') teams[teamId] = { ...team, agencyId };
      }
      const options = Object.fromEntries(Object.entries(assignments).filter(([, item]) => incidents[item.incidentId]).map(([assignmentId, item]) => {
        const team = teams[item.teamId] || {};
        const agency = city.agency?.[item.agencyId]; const stationId = team.stationId || item.stationId;
        const station = agency?.stations?.[stationId] || city.stations?.[stationId] || state.stations?.[stationId];
        return [assignmentId, { incidentId: item.incidentId, agencyName: agency?.profile?.name || item.agencyId, teamName: team.name || item.teamId,
          stationName: station?.name || stationId || '', assignedAt: item.assignedAt || null, arrivedAt: item.arrivedAt || null, completedAt: item.completedAt || null }];
      }));
      const agency = city.agency?.[user.agencyId];
      const station = agency?.stations?.[user.stationId] || city.stations?.[user.stationId] || state.stations?.[user.stationId];
      return { reports, assignments: options, incidents, agencyName: agency?.profile?.name || user.agencyId || '', stationName: station?.name || user.stationId || '' };
    },
    // Summary for meetings: one month and one incident type, from the reports this user can already see.
    // Agency administrators see their agency's reports; Command Center and System Administrators see all.
    async responseSummary(uid, input = {}) {
      const state = await repo.read('/') || {};
      const user = operator(state, uid);
      if (!['AGENCY_ADMIN', 'COMMAND_ADMIN', 'SYSTEM_ADMIN'].includes(user.role)) fail('Administrator access is required for summaries.', 403);
      const month = typeof input.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(input.month) ? input.month : fail('Choose a month (YYYY-MM).');
      const emergencyType = typeof input.emergencyType === 'string' && input.emergencyType ? input.emergencyType : 'ROAD_ACCIDENT';
      const incidents = incidentsOf(state);
      const scoped = user.role === 'AGENCY_ADMIN';
      const typeOf = report => report.emergencyType || incidents[report.incidentId]?.type || '';
      // Report time: DATE and TIME_CALL (structured reports), or incidentDateTime (agency-created reports).
      const whenOf = report => {
        if (typeof report.DATE === 'string' && typeof report.TIME_CALL === 'string') return Date.parse(`${report.DATE}T${report.TIME_CALL}:00+08:00`);
        return Number.isFinite(report.incidentDateTime) ? report.incidentDateTime : null;
      };
      const phDate = time => new Date(time + PH_OFFSET_MS);
      const reports = Object.entries(reportsOf(state))
        .map(([reportId, report]) => ({ ...report, reportId }))
        .filter(report => report && report.status !== 'RETURNED' && (!scoped || report.agencyId === user.agencyId))
        .map(report => ({ ...report, when: whenOf(report) ?? report.submittedAt }))
        .filter(report => Number.isFinite(report.when) && phDate(report.when).toISOString().slice(0, 7) === month && typeOf(report) === emergencyType);
      // One incident counts once, even when several reports cover it.
      const byIncident = new Map();
      for (const report of reports) {
        const key = report.incidentId || `report:${report.reportId}`;
        if (!byIncident.has(key)) byIncident.set(key, report);
      }
      const incidentsInMonth = [...byIncident.values()];
      const tally = (values, allowed) => {
        const counts = Object.fromEntries([...allowed, 'NOT_RECORDED'].map(key => [key, 0]));
        for (const value of values) { const key = value || 'NOT_RECORDED'; counts[key] = (counts[key] || 0) + 1; }
        return counts;
      };
      const patients = reports.flatMap(report => report.patients || []);
      const genderOf = patient => { const value = String(patient.PATIENT_GENDER_spinner || patient.gender || '').trim(); if (/^m/i.test(value)) return 'MALE'; if (/^f/i.test(value)) return 'FEMALE'; return 'UNKNOWN'; };
      const genders = patients.map(genderOf);
      const hours = Array(24).fill(0);
      for (const report of incidentsInMonth) hours[phDate(report.when).getUTCHours()] += 1;
      let peak = null;
      // Fixed four-hour blocks (00:00–04:00, 04:00–08:00, …); the busiest block wins, the earliest on a tie.
      for (let start = 0; start < 24; start += 4) {
        const count = hours.slice(start, start + 4).reduce((sum, value) => sum + value, 0);
        if (count > 0 && (!peak || count > peak.count)) peak = { start, count };
      }
      const pad = value => String(value).padStart(2, '0');
      const barangayOf = report => {
        const text = report.SCENE_LOCATION || report.incidentLocation || '';
        const match = text.match(/Brgy\.?\s*([^·,(\n]+)/i);
        return (match ? match[1].trim() : '') || incidents[report.incidentId]?.location?.barangay || '';
      };
      const barangays = {};
      for (const report of incidentsInMonth) { const name = barangayOf(report) || 'NOT_RECORDED'; barangays[name] = (barangays[name] || 0) + 1; }
      return {
        month, emergencyType,
        totalIncidents: incidentsInMonth.length,
        byCrashType: tally(incidentsInMonth.map(report => report.CRASH_TYPE || report.crashType || ''), CRASH_TYPES),
        byVehicleType: tally(incidentsInMonth.map(report => report.VEHICLE_TYPE || report.vehicleType || ''), VEHICLE_TYPES),
        casualties: { total: patients.length, male: genders.filter(item => item === 'MALE').length, female: genders.filter(item => item === 'FEMALE').length, unknown: genders.filter(item => item === 'UNKNOWN').length },
        bySeverity: tally(patients.map(patient => patient.SEVERITY || patient.severity || ''), SEVERITIES),
        byVictimRole: tally(patients.map(patient => patient.VICTIM_ROLE || patient.victimRole || ''), VICTIM_ROLES),
        byLicence: tally(patients.map(patient => patient.LICENSED || patient.licensed || ''), LICENCE_STATUSES),
        peakWindow: peak ? { from: `${pad(peak.start)}:00`, to: `${pad(peak.start + 4)}:00`, count: peak.count } : null,
        byBarangay: Object.entries(barangays).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      };
    },
    async submitResponseReport(uid, input) {
      const details = clean(input); const assignmentId = input.assignmentId ? key(input.assignmentId, 'assignment') : null; const reportId = input.reportId ? key(input.reportId, 'report') : id(); const timestamp = now();
      let agencyCreated = false;
      await repo.transact('/', state => {
        const user = operator(state, uid); const city = cityOf(state);
        agencyCreated = user.role === 'AGENCY_ADMIN';
        if (!agencyCreated && user.role !== 'RESPONDER') fail('Only responders or agency administrators can create reports.', 403);
        const previous = city.command_center?.response_reports?.[reportId];
        if (agencyCreated && input.reportId) fail('Agency-created reports cannot replace submitted reports.', 403);
        if (input.reportId && (!previous || previous.submittedBy !== uid || previous.agencyId !== user.agencyId || previous.status !== 'RETURNED' || previous.assignmentId !== assignmentId)) fail('Only your returned report can be resubmitted.', 403);
        if (details.schemaVersion === 2) {
          const assignment = assignmentId ? assignmentsOf(state)[assignmentId] : null;
          if (!agencyCreated && (!assignment || assignment.agencyId !== user.agencyId || !user.teamId || assignment.teamId !== user.teamId)) fail('Your assigned responding team is required.', 403);
          if (assignmentId && (!assignment || assignment.agencyId !== user.agencyId || assignment.isSimulation === true)) fail('Your assigned responding team is required.', 403);
          const incidentId = assignment?.incidentId || (agencyCreated && input.incidentId ? key(input.incidentId, 'incident') : null);
          if (agencyCreated && incidentId && !assignment && !agencyIncident(state, user, incidentId, incidentsOf(state)[incidentId])) fail('This incident is outside your agency. Only agencies that lead it, responded to it, or had a team dispatched to it can file its report.', 403);
          if (incidentId && (!incidentsOf(state)[incidentId] || incidentsOf(state)[incidentId].isSimulation === true)) fail('A live incident is required.');
          city.command_center ||= {}; city.command_center.response_reports ||= {};
          city.command_center.response_reports[reportId] = { ...details, assignmentId, incidentId, agencyId: user.agencyId,
            agencyName: city.agency[user.agencyId].profile.name || user.agencyId,
            submittedBy: uid, submittedByName: user.displayName || uid, submittedAt: timestamp,
            status: agencyCreated ? 'APPROVED' : 'PENDING_REVIEW', creationSource: agencyCreated ? 'AGENCY_MANUAL' : 'RESPONDER', approvalRequired: !agencyCreated,
            revision: (previous?.revision || 0) + 1, previousReviews: previous ? [...(previous.previousReviews || []), { status: previous.status, reviewRemarks: previous.reviewRemarks || '', reviewedBy: previous.reviewedBy, reviewedAt: previous.reviewedAt }] : [] };
          return state;
        }
        const manualTeam = agencyCreated && !assignmentId;
        const assignment = assignmentId ? assignmentsOf(state)[assignmentId] : null;
        if (!manualTeam && (!assignment || assignment.agencyId !== user.agencyId || (!agencyCreated && (!user.teamId || assignment.teamId !== user.teamId)))) fail('Your assigned responding team is required.', 403);
        const incidentId = manualTeam ? (input.incidentId ? key(input.incidentId, 'incident') : null) : assignment.incidentId;
        let incident = incidentId ? incidentsOf(state)[incidentId] : null;
        if (incidentId && (!incident || incident.isSimulation === true || assignment?.isSimulation === true)) fail('A live incident is required.');
        if (manualTeam && incidentId && !agencyIncident(state, user, incidentId, incident)) fail('This incident is outside your agency. Only agencies that lead it, responded to it, or had a team dispatched to it can file its report.', 403);
        if (!incidentId) {
          if (!manualTeam) fail('A live incident is required.');
          if (typeof input.incidentDateTime !== 'number' || !Number.isFinite(input.incidentDateTime) || input.incidentDateTime <= 0) fail('Enter a valid incident date and time.');
          incident = { type: text(input.emergencyType, 'emergency type'), createdAt: input.incidentDateTime,
            location: { address: text(input.incidentLocation, 'incident location') }, description: text(input.descriptionCause, 'description / cause') };
        }
        const teamName = manualTeam ? text(input.teamName, 'responding team') : null;
        const agency = city.agency[user.agencyId];
        const team = assignment ? agency.teams?.[assignment.teamId] || state.teams?.[assignment.teamId] : null;
        const stationId = team?.stationId || assignment?.stationId || user.stationId;
        const station = agency.stations?.[stationId] || city.stations?.[stationId] || state.stations?.[stationId];
        const report = { ...details, incidentId, assignmentId, agencyId: user.agencyId,
          agencyName: agency.profile.name || user.agencyId, teamId: assignment?.teamId || null, teamName: manualTeam ? teamName : team?.name || assignment.teamId,
          stationId: stationId || null, stationName: station?.name || stationId || '', emergencyType: incident.type || incident.emergencyType || '',
          incidentDateTime: incident.createdAt || null, incidentLocation: incident.location?.address || incident.locationName || '', descriptionCause: incident.description || '',
          submittedBy: uid, submittedByName: user.displayName || uid, submittedAt: timestamp, status: agencyCreated ? 'APPROVED' : 'PENDING_REVIEW',
          creationSource: agencyCreated ? 'AGENCY_MANUAL' : 'RESPONDER', approvalRequired: !agencyCreated,
          revision: (previous?.revision || 0) + 1, previousReviews: previous ? [...(previous.previousReviews || []), { status: previous.status, reviewRemarks: previous.reviewRemarks || '', reviewedBy: previous.reviewedBy, reviewedAt: previous.reviewedAt }] : [] };
        city.command_center ||= {}; city.command_center.response_reports ||= {};
        city.command_center.response_reports[reportId] = report;
        return state;
      });
      return { id: reportId, message: agencyCreated ? 'Agency report saved as approved. No review is required.' : 'Report submitted for agency review.' };
    },
    async reviewResponseReport(uid, reportId, input) {
      reportId = key(reportId, 'report');
      if (!['APPROVED', 'RETURNED'].includes(input.status)) fail('Choose approve or return for correction.');
      const reviewRemarks = text(input.reviewRemarks ?? '', 'review remarks', input.status === 'RETURNED');
      const timestamp = now();
      await repo.transact('/', state => {
        const user = operator(state, uid); const report = cityOf(state).command_center?.response_reports?.[reportId];
        if (user.role !== 'AGENCY_ADMIN' || !report || report.agencyId !== user.agencyId) fail('Only this report’s agency administrator can review it.', 403);
        if (report.status !== 'PENDING_REVIEW') fail('This report has already been reviewed.', 409);
        if (report.submittedBy === uid) fail('A report cannot be self-approved.', 403);
        Object.assign(report, { status: input.status, reviewRemarks, reviewedBy: uid, reviewedAt: timestamp });
        return state;
      });
      return { message: input.status === 'APPROVED' ? 'Report approved and saved.' : 'Report returned for correction.' };
    },
  };
}
export { createResponseReports };
