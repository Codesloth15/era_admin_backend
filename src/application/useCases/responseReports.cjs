const { CITY } = require('../dataPaths.cjs');
const { fail, key, agencyInvolvedInIncident } = require('../../domain/agencyRules.cjs');

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
        return entry;
      });
      return result;
    }
    const result = {};
    for (const field of ['vehicleUsed', 'sceneAssessment', 'actionsTaken', 'assistanceProvided', 'incidentOutcome', 'respondingPersonnel']) result[field] = text(input[field], field);
    for (const field of ['hospitalDestination', 'additionalRemarks']) result[field] = text(input[field] ?? '', field, false);
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
module.exports = { createResponseReports };
