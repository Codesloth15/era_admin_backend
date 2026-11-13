const { fail } = require('./agencyRules.cjs');

// Same type codes as the citizen app. MEDICAL is shown as "Rescue" and OTHER as "PNP".
const INCIDENT_TYPES = ['FIRE', 'ROAD_ACCIDENT', 'MEDICAL', 'OTHER'];
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

// Agencies each type needs, matching citizen reports. CDRRMO is always included.
function recommendedAgenciesFor(type) {
  const agencies = { CDRRMO: true };
  if (type === 'FIRE') Object.assign(agencies, { BFP: true, MEDICAL: true });
  if (type === 'ROAD_ACCIDENT') Object.assign(agencies, { PNP: true, MEDICAL: true });
  if (type === 'MEDICAL') agencies.MEDICAL = true;
  return agencies;
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

module.exports = { INCIDENT_TYPES, recommendedAgenciesFor, staffIncidentInput };
