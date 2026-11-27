import { CITY, INCIDENTS } from '../config/data-paths.js';
import { fail, key } from './rules/agency.rules.js';
import { roadRoutingCandidates, routeIncident, staffIncidentInput } from './rules/incident.rules.js';

const COMMAND_ROLES = ['SYSTEM_ADMIN', 'COMMAND_ADMIN'];
// The active agencies that incidents can be routed to, with their emergency types and station points.
// A station has an available team when one of the agency's active teams there is AVAILABLE.
const routingAgencies = city => Object.entries(city.agency || {})
  .map(([agencyId, agency]) => {
    const teams = Object.values(agency?.teams || {}).filter(team => team?.active === true && team.status === 'AVAILABLE');
    return {
      id: agencyId,
      active: agency?.profile?.active === true,
      emergencyTypes: agency?.profile?.emergencyTypes || [],
      stations: Object.entries(agency?.stations || {})
        .filter(([, station]) => station && typeof station === 'object')
        .map(([stationId, station]) => ({
          id: stationId,
          active: station.active !== false,
          latitude: station.latitude ?? station.location?.latitude,
          longitude: station.longitude ?? station.location?.longitude,
          hasAvailableTeam: teams.some(team => team.stationId === stationId),
        })),
    };
  });
const routingTable = city => city.system_config?.dispatch?.routing;

// Staff create emergencies from the Emergency Monitor map. The incident is written to
// incidents/ in the same shape as citizen reports, so every screen picks it up.
function createStaffIncidents({ repo, roadRouting, id, now }) {
  // Driving times from the incident to each candidate station, keyed `${agencyId}/${stationId}`. Read before the
  // write so the network call stays outside the transaction. On any failure stations are ranked by
  // straight-line distance, so routing never stops an emergency from being created or verified.
  async function roadTravelSeconds(type, location) {
    if (!roadRouting) return {};
    try {
      const city = {
        agency: await repo.read(`${CITY}/agency`),
        system_config: { dispatch: { routing: await repo.read(`${CITY}/system_config/dispatch/routing`) } },
      };
      const candidates = roadRoutingCandidates(type, location, routingAgencies(city), routingTable(city));
      if (!candidates.length) return {};
      const seconds = await roadRouting.travelSeconds(location, candidates);
      return Object.fromEntries(candidates.map((candidate, index) => [candidate.key, seconds[index]]).filter(([, value]) => Number.isFinite(value)));
    } catch (error) {
      console.warn(`Road travel times unavailable; routing by straight-line distance. (${error.message})`);
      return {};
    }
  }
  return {
    async createStaffIncident(uid, input) {
      const details = staffIncidentInput(input);
      const travelSeconds = await roadTravelSeconds(details.type, details);
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

        const routed = routeIncident(details.type, { latitude: details.latitude, longitude: details.longitude }, routingAgencies(city), routingTable(city), travelSeconds);
        const leadAgencyId = agencyAdmin ? user.agencyId : routed.leadAgencyId;
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
          recommendedAgencies: { ...routed.recommendedAgencies, ...(leadAgencyId ? { [leadAgencyId]: true } : {}) },
          recommendedStations: routed.recommendedStations,
          owner: leadAgencyId || 'COMMAND_CENTER',
          routingMethod: routed.routingMethod,
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
    // Command Center verification: the citizen report is routed to the nearest agency (and the
    // agencies that handle its type), then marked verified. It can only be done once.
    async verifyIncident(uid, incidentId) {
      incidentId = key(incidentId, 'incident ID');
      const pending = await repo.read(`${INCIDENTS}/${incidentId}`);
      const travelSeconds = pending?.needsOperatorVerification === true ? await roadTravelSeconds(pending.type, pending.location) : {};
      const auditId = id(); const timestamp = now();
      await repo.transact('/', state => {
        const city = state?.server?.['City of Tabuk'] || {};
        const user = city.users?.[uid] ?? state?.users?.[uid];
        if (!(user?.active === true && COMMAND_ROLES.includes(user.role))) fail('Command Center access is required.', 403);
        const incident = state?.incidents?.[incidentId];
        if (!incident) fail('Incident no longer exists.', 404);
        if (incident.needsOperatorVerification !== true) fail('This report has already been verified.', 409);
        const routed = routeIncident(incident.type, incident.location, routingAgencies(city), routingTable(city), travelSeconds);
        Object.assign(incident, {
          leadAgencyId: routed.leadAgencyId, owner: routed.owner,
          recommendedAgencies: routed.recommendedAgencies, recommendedStations: routed.recommendedStations, routingMethod: routed.routingMethod,
          needsOperatorVerification: false, verifiedBy: uid, verifiedAt: timestamp, updatedAt: timestamp, version: (incident.version || 1) + 1,
        });
        state.server ||= {}; state.server['City of Tabuk'] ||= {};
        const center = state.server['City of Tabuk'].command_center ||= {};
        center.audit_logs ||= {};
        center.audit_logs[auditId] = { actorUid: uid, targetUid: null, resourceId: incidentId, agencyId: null, action: 'INCIDENT_VERIFIED', timestamp };
        return state;
      });
      return { message: 'Report verified and routed.' };
    },
  };
}

export { createStaffIncidents };
