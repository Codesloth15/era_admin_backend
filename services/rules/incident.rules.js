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
// active station with an available team inside the radius, is recommended. The nearest one leads; the others
// are supporting. Recommendations guide people; they never block anyone from seeing, acknowledging or
// responding to an incident. With no location or no recommended agency, the Command Center owns it.
// The radius is read from settings (system_config.dispatch.routing.radiusKm), 30 km by default.
const DEFAULT_RADIUS_KM = 30;
const toRadians = value => value * Math.PI / 180;
function distanceKm(a, b) {
  const dLat = toRadians(b.latitude - a.latitude); const dLon = toRadians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
// agencies: [{ id, active, emergencyTypes: [], stations: [{ id, latitude, longitude, active, hasAvailableTeam }] }]
// routing: { radiusKm }
function routeIncident(type, location, agencies, routing = {}) {
  const wanted = normalizeIncidentType(type);
  const radiusKm = Number.isFinite(routing?.radiusKm) && routing.radiusKm > 0 ? routing.radiusKm : DEFAULT_RADIUS_KM;
  const hasLocation = Number.isFinite(location?.latitude) && Number.isFinite(location?.longitude);
  const commandCenter = { leadAgencyId: null, owner: 'COMMAND_CENTER', pendingLeadAgencyIds: [], recommendedAgencies: {}, recommendedStations: {} };
  if (!hasLocation) return { ...commandCenter, routingMethod: 'NO_LOCATION' };
  const origin = { latitude: location.latitude, longitude: location.longitude };
  // Each covering agency is recommended at its nearest qualifying station.
  const recommended = agencies
    .filter(agency => agency.active !== false && (agency.emergencyTypes || []).some(item => normalizeIncidentType(item) === wanted))
    .map(agency => {
      const nearest = agency.stations
        .filter(station => station.active !== false && station.hasAvailableTeam === true && Number.isFinite(station.latitude) && Number.isFinite(station.longitude))
        .map(station => ({ station, distance: distanceKm(origin, station) }))
        .filter(item => item.distance <= radiusKm)
        .sort((a, b) => a.distance - b.distance || String(a.station.id).localeCompare(String(b.station.id)))[0];
      return nearest ? { agencyId: agency.id, stationId: nearest.station.id, distance: nearest.distance } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance || a.agencyId.localeCompare(b.agencyId));
  if (!recommended.length) return { ...commandCenter, routingMethod: 'NO_LEAD_IN_RANGE' };
  const leadAgencyId = recommended[0].agencyId;
  return {
    leadAgencyId,
    owner: leadAgencyId,
    pendingLeadAgencyIds: [],
    recommendedAgencies: Object.fromEntries(recommended.map(item => [item.agencyId, true])),
    recommendedStations: Object.fromEntries(recommended.map(item => [item.agencyId, item.stationId])),
    routingMethod: 'NEAREST_STATION',
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

export { INCIDENT_TYPES, DEFAULT_RADIUS_KM, normalizeIncidentType, routeIncident, staffIncidentInput };
