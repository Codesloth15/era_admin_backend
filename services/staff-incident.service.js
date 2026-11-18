import { fail } from './rules/agency.rules.js';
import { recommendedAgenciesFor, staffIncidentInput } from './rules/incident.rules.js';

const COMMAND_ROLES = ['SYSTEM_ADMIN', 'COMMAND_ADMIN'];
const LEAD_FOR_COMMAND = 'CDRRMO';

// Staff create emergencies from the Emergency Monitor map. The incident is written to
// incidents/ in the same shape as citizen reports, so every screen picks it up.
function createStaffIncidents({ repo, id, now }) {
  return {
    async createStaffIncident(uid, input) {
      const details = staffIncidentInput(input);
      const incidentId = id(); const eventId = id(); const auditId = id(); const timestamp = now();
      await repo.transact('/', state => {
        state ||= {};
        const city = state.server?.['City of Tabuk'] || {};
        const user = city.users?.[uid] ?? state.users?.[uid];
        const command = user?.active === true && COMMAND_ROLES.includes(user.role);
        const agencyAdmin = user?.active === true && user.role === 'AGENCY_ADMIN' && user.authProvisioned === true
          && Boolean(user.agencyId) && city.agency?.[user.agencyId]?.profile?.active === true;
        if (!command && !agencyAdmin) fail('Command Center or agency administrator access is required.', 403);
        if (state.incidents?.[incidentId]) fail('Please try again.', 409);

        const leadAgencyId = agencyAdmin ? user.agencyId : LEAD_FOR_COMMAND;
        const agencyName = agencyAdmin ? city.agency[user.agencyId].profile.name || user.agencyId : 'Command Center';
        const incident = {
          type: details.type,
          description: details.description,
          priority: 'HIGH',
          status: 'RECEIVED',
          isSimulation: false,
          needsOperatorVerification: false,
          location: {
            latitude: details.latitude, longitude: details.longitude,
            address: `${details.barangay ? `Brgy. ${details.barangay.name} · pinned on map` : 'Pinned on map'} (${details.latitude.toFixed(5)}, ${details.longitude.toFixed(5)})`,
            source: 'OPERATOR_MAP', capturedAt: timestamp, updatedAt: timestamp,
            ...(details.barangay ? { barangay: details.barangay.name, barangayCode: details.barangay.pcode } : {}),
          },
          leadAgencyId,
          recommendedAgencies: { ...recommendedAgenciesFor(details.type), [leadAgencyId]: true },
          creationSource: 'STAFF_MAP',
          createdBy: uid,
          createdByName: user.displayName || uid,
          createdByAgencyId: agencyAdmin ? user.agencyId : null,
          createdAt: timestamp, updatedAt: timestamp, clientReportedAt: timestamp,
          version: 1,
        };
        if (details.reporterName) incident.reporterName = details.reporterName;
        if (details.reporterPhone) incident.reporterPhone = details.reporterPhone;

        state.incidents ||= {};
        state.incidents[incidentId] = incident;
        state.incident_events ||= {};
        state.incident_events[incidentId] = { [eventId]: {
          type: 'INCIDENT_CREATED', agencyId: agencyAdmin ? user.agencyId : null, agencyName, actorId: uid, timestamp, isSimulation: false,
        } };
        state.server ||= {}; state.server['City of Tabuk'] ||= {};
        const center = state.server['City of Tabuk'].command_center ||= {};
        center.audit_logs ||= {};
        center.audit_logs[auditId] = { actorUid: uid, targetUid: null, resourceId: incidentId, agencyId: agencyAdmin ? user.agencyId : null, action: 'INCIDENT_CREATED_BY_STAFF', timestamp };
        return state;
      });
      return { id: incidentId, message: 'Emergency created. It now appears on the map and in the alert list.' };
    },
  };
}

export { createStaffIncidents };
