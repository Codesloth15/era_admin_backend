const { fail } = require('./agencyRules.cjs');

const CATEGORIES = ['WARNING', 'ANNOUNCEMENT', 'SAFETY_TIP'];
const SEVERITIES = ['CRITICAL', 'HIGH', 'MODERATE', 'INFORMATION'];
const COMMAND_CENTER = 'COMMAND_CENTER';
// CITYWIDE, or SPECIFIC: a map pin with a radius and a typed place name.
const AREAS = ['CITYWIDE', 'SPECIFIC'];
const RADII = [250, 500, 1000, 2000, 5000];
// Rough Philippine bounds, so a misplaced click far outside the country is rejected.
const inPhilippines = (latitude, longitude) => latitude >= 4 && latitude <= 22 && longitude >= 116 && longitude <= 127;
const round = value => Math.round(value * 1e6) / 1e6;

const text = (value, label, max, required) => {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > max) fail(`Invalid ${label}.`);
  const trimmed = value.trim();
  if (required && !trimmed) fail(`Enter the ${label}.`);
  return trimmed;
};

// Drafts only need a title; publishing requires every field citizens will see.
function advisoryInput(input, { publishing = false } = {}) {
  if (!input || typeof input !== 'object') fail('Advisory details are required.');
  const category = input.category || 'WARNING';
  const severity = input.severity || 'INFORMATION';
  const area = input.area || 'CITYWIDE';
  if (!CATEGORIES.includes(category)) fail('Choose a valid category.');
  if (!SEVERITIES.includes(severity)) fail('Choose a valid severity.');
  if (!AREAS.includes(area)) fail('Choose citywide or a specific affected area.');
  const actions = input.actions === undefined ? [] : input.actions;
  if (!Array.isArray(actions) || actions.length > 10) fail('Enter up to 10 safety actions.');
  const cleanActions = actions.map(action => text(action, 'safety action', 300, false)).filter(Boolean);
  let expiresAt = null;
  if (input.expiresAt !== undefined && input.expiresAt !== null && input.expiresAt !== '') {
    if (!Number.isFinite(input.expiresAt) || input.expiresAt <= 0) fail('Invalid expiration time.');
    expiresAt = input.expiresAt;
  }
  const advisory = {
    title: text(input.title, 'advisory title', 160, true),
    category, severity, area,
    location: area === 'SPECIFIC' ? areaLocationInput(input.location, publishing) : null,
    agencyId: text(input.agencyId || COMMAND_CENTER, 'issuing agency', 60, true),
    shortDescription: text(input.shortDescription, 'short description', 300, publishing),
    fullMessage: text(input.fullMessage, 'full message', 5000, publishing),
    actions: cleanActions,
    expiresAt,
  };
  if (publishing && !cleanActions.length) fail('Add at least one safety action.');
  return advisory;
}

// Drafts may leave the pin or name empty; publishing needs both.
function areaLocationInput(value, publishing) {
  if (value === undefined || value === null) {
    if (publishing) fail('Pick the affected area on the map.');
    return null;
  }
  if (typeof value !== 'object') fail('Invalid affected area.');
  const { latitude, longitude } = value;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !inPhilippines(latitude, longitude)) fail('Pick the affected area on the map.');
  const radiusMeters = value.radiusMeters ?? 1000;
  if (!RADII.includes(radiusMeters)) fail('Choose a valid radius.');
  return { latitude: round(latitude), longitude: round(longitude), radiusMeters, label: text(value.label, 'affected area name', 120, publishing) };
}

// One optional cover image. The type is checked against the file's own bytes, not just its label.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES = {
  'image/jpeg': { ext: 'jpg', matches: bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  'image/png': { ext: 'png', matches: bytes => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', matches: bytes => bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP' },
};
function advisoryImageInput(input) {
  const type = IMAGE_TYPES[input?.contentType];
  if (!type) fail('Use a JPG, PNG or WebP image.');
  if (typeof input.data !== 'string' || !input.data || input.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.data)) fail('The image must be 3 MB or smaller.');
  const buffer = Buffer.from(input.data, 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) fail('The image must be 3 MB or smaller.');
  if (!type.matches(buffer)) fail('The file content does not match its image type.');
  return { buffer, contentType: input.contentType, ext: type.ext };
}

// What the citizen app may read: no author IDs or internal status.
const publicAdvisory = advisory => ({
  title: advisory.title, category: advisory.category, severity: advisory.severity, area: advisory.area,
  agencyName: advisory.agencyName, shortDescription: advisory.shortDescription, fullMessage: advisory.fullMessage,
  location: advisory.location || null, actions: advisory.actions || [], issuedAt: advisory.issuedAt, expiresAt: advisory.expiresAt || null,
  imageUrl: advisory.image?.url || null,
});

module.exports = { CATEGORIES, SEVERITIES, AREAS, RADII, COMMAND_CENTER, MAX_IMAGE_BYTES, advisoryInput, advisoryImageInput, publicAdvisory };
