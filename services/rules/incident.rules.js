import { fail } from './agency.rules.js';

// Incident types: Fire, Road accident, Rescue and Police. The old MEDICAL and OTHER codes (saved by the citizen app
// and earlier staff reports) mean RESCUE and POLICE.
const INCIDENT_TYPES = ['FIRE', 'ROAD_ACCIDENT', 'RESCUE', 'POLICE'];
const LEGACY_TYPES = { MEDICAL: 'RESCUE', OTHER: 'POLICE' };
const normalizeIncidentType = type => LEGACY_TYPES[type] || type;
// Rough Philippine bounds, so a misplaced click far outside the country is rejected.
const inPhilippines = (latitude, longitude) => latitude >= 4 && latitude <= 22 && longitude >= 116 && longitude <= 127;
// Mobile or landline: digits with optional +, spaces or dashes.
const PHONE = /^\+?[0-9][0-9 -]{5,18}[0-9]$/;
const TABUK_BARANGAY_CODE = /^PH1403213\d{3}$/;
const round = value => Math.round(value * 1e6) / 1e6;

const optionalText = (value, label, max) => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) fail(`Invalid ${label}.`);
  return value.trim();
};

// Routing is automatic: every active agency whose emergencyTypes include the incident type, and that has an
// active station with an available team inside the radius, is recommended. The closest one leads; the others
// are supporting. "Closest" means the shortest driving time when road travel times are known, otherwise the
// shortest straight-line distance. Recommendations guide people; they never block anyone from seeing,
// acknowledging or responding to an incident. With no location or no recommended agency, the Command Center owns it.
// The radius (straight-line) is read from settings (system_config.dispatch.routing.radiusKm), 30 km by default.
const DEFAULT_RADIUS_KM = 30;
const toRadians = value => value * Math.PI / 180;
function distanceKm(a, b) {
  const dLat = toRadians(b.latitude - a.latitude); const dLon = toRadians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
// Station IDs are only unique within an agency.
const stationKey = (agencyId, stationId) => `${agencyId}/${stationId}`;
// Every qualifying station inside the radius, grouped by covering agency; null when the incident has no location.
function qualifyingStations(type, location, agencies, routing) {
  if (!Number.isFinite(location?.latitude) || !Number.isFinite(location?.longitude)) return null;
  const wanted = normalizeIncidentType(type);
  const radiusKm = Number.isFinite(routing?.radiusKm) && routing.radiusKm > 0 ? routing.radiusKm : DEFAULT_RADIUS_KM;
  const origin = { latitude: location.latitude, longitude: location.longitude };
  return agencies
    .filter(agency => agency.active !== false && (agency.emergencyTypes || []).some(item => normalizeIncidentType(item) === wanted))
    .map(agency => ({
      agencyId: agency.id,
      stations: agency.stations
        .filter(station => station.active !== false && station.hasAvailableTeam === true && Number.isFinite(station.latitude) && Number.isFinite(station.longitude))
        .map(station => ({ station, distance: distanceKm(origin, station) }))
        .filter(item => item.distance <= radiusKm),
    }))
    .filter(agency => agency.stations.length);
}
// The stations to ask the road routing service about: { key, latitude, longitude }.
function roadRoutingCandidates(type, location, agencies, routing = {}) {
  return (qualifyingStations(type, location, agencies, routing) || []).flatMap(({ agencyId, stations }) =>
    stations.map(({ station }) => ({ key: stationKey(agencyId, station.id), latitude: station.latitude, longitude: station.longitude })));
}
// Stations with a known driving time come first (fastest first); stations without one follow, nearest first.
const travel = item => (Number.isFinite(item.seconds) ? item.seconds : Infinity);
const closer = (a, b) => (travel(a) === travel(b) ? 0 : travel(a) - travel(b)) || a.distance - b.distance;
// agencies: [{ id, active, emergencyTypes: [], stations: [{ id, latitude, longitude, active, hasAvailableTeam }] }]
// routing: { radiusKm }
// travelSeconds: optional driving time in seconds per station, keyed `${agencyId}/${stationId}`.
function routeIncident(type, location, agencies, routing = {}, travelSeconds = {}) {
  const commandCenter = { leadAgencyId: null, owner: 'COMMAND_CENTER', pendingLeadAgencyIds: [], recommendedAgencies: {}, recommendedStations: {} };
  const covering = qualifyingStations(type, location, agencies, routing);
  if (!covering) return { ...commandCenter, routingMethod: 'NO_LOCATION' };
  // Each covering agency is recommended at its closest qualifying station.
  const recommended = covering
    .map(({ agencyId, stations }) => {
      const best = stations
        .map(item => ({ ...item, seconds: travelSeconds?.[stationKey(agencyId, item.station.id)] }))
        .sort((a, b) => closer(a, b) || String(a.station.id).localeCompare(String(b.station.id)))[0];
      return { agencyId, stationId: best.station.id, distance: best.distance, seconds: best.seconds };
    })
    .sort((a, b) => closer(a, b) || a.agencyId.localeCompare(b.agencyId));
  if (!recommended.length) return { ...commandCenter, routingMethod: 'NO_LEAD_IN_RANGE' };
  const leadAgencyId = recommended[0].agencyId;
  return {
    leadAgencyId,
    owner: leadAgencyId,
    pendingLeadAgencyIds: [],
    recommendedAgencies: Object.fromEntries(recommended.map(item => [item.agencyId, true])),
    recommendedStations: Object.fromEntries(recommended.map(item => [item.agencyId, item.stationId])),
    routingMethod: Number.isFinite(recommended[0].seconds) ? 'FASTEST_ROAD_ROUTE' : 'NEAREST_STATION',
  };
}

// An emergency created by staff by clicking the map (phone call or walk-in report).
function staffIncidentInput(input) {
  if (!input || typeof input !== 'object') fail('Emergency details are required.');
  if (!INCIDENT_TYPES.includes(input.type)) fail('Choose the type of emergency.');
  const { latitude, longitude } = input;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !inPhilippines(latitude, longitude)) fail('Click the map where the emergency is.');
  const reporterPhone = optionalText(input.reporterPhone, 'caller phone number', 20);
  if (reporterPhone && !PHONE.test(reporterPhone)) fail('Enter a valid caller phone number.');
  // Optional barangay detected by the web admin from official boundaries (PSGC codes of City of Tabuk).
  let barangay = null;
  if (input.barangay !== undefined && input.barangay !== null) {
    const { name, pcode } = input.barangay;
    if (typeof pcode !== 'string' || !TABUK_BARANGAY_CODE.test(pcode) || typeof name !== 'string' || !name.trim() || name.length > 80) fail('Invalid barangay.');
    barangay = { name: name.trim(), pcode };
  }
  return {
    barangay,
    type: input.type,
    description: optionalText(input.description, 'description', 2000),
    latitude: round(latitude),
    longitude: round(longitude),
    reporterName: optionalText(input.reporterName, 'caller name', 120),
    reporterPhone,
  };
}

export { INCIDENT_TYPES, DEFAULT_RADIUS_KM, normalizeIncidentType, routeIncident, roadRoutingCandidates, staffIncidentInput };
