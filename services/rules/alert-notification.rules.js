import { normalizeIncidentType } from './incident.rules.js';

// Push notifications for new citizen alerts: which alerts qualify, who receives them and what they say.
// No Express or Firebase here.

// Alerts older than this when the backend first sees them are not pushed, so a restart or first deploy
// never resends old alerts. Short downtime is still covered.
const MAX_ALERT_AGE_MS = 10 * 60 * 1000;
// Must match the notification channel created by the responder app.
const ALERT_CHANNEL_ID = 'emergency_alerts';
// FCM accepts at most 500 tokens per multicast request.
const MAX_TOKENS_PER_SEND = 500;
const FINISHED_STATUSES = ['RESOLVED', 'CANCELLED', 'CLOSED'];
// FCM error codes meaning the phone's token will never work again (app uninstalled, data cleared).
const DEAD_TOKEN_ERRORS = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'];
const TYPE_LABELS = { FIRE: 'fire', ROAD_ACCIDENT: 'road accident', RESCUE: 'rescue', POLICE: 'police' };
const MAX_ADDRESS_LENGTH = 150;

// Why an alert gets no push, or null when it should be pushed.
function skipReason(incident, now) {
  if (!incident || typeof incident !== 'object') return 'NOT_AN_ALERT';
  if (incident.isSimulation === true) return 'SIMULATION';
  if (FINISHED_STATUSES.includes(incident.status)) return 'FINISHED';
  if (!Number.isFinite(incident.createdAt)) return 'NO_CREATED_TIME';
  if (now - incident.createdAt > MAX_ALERT_AGE_MS) return 'TOO_OLD';
  return null;
}

// Barangay boundaries are a GeoJSON FeatureCollection; coordinates are [longitude, latitude].
const rings = geometry => (geometry?.type === 'Polygon' ? [geometry.coordinates]
  : geometry?.type === 'MultiPolygon' ? geometry.coordinates : []);

// Ray casting: is the point inside this ring?
function inRing(longitude, latitude, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > latitude) !== (yj > latitude) && longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// The Tabuk City barangay the alert's GPS point falls in, or null when it is outside the city or has no point.
// Uses the coordinates only, never the typed address.
function tabukBarangay(location, boundaries) {
  const latitude = Number(location?.latitude); const longitude = Number(location?.longitude);
  if (location?.latitude == null || location?.longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const feature = (boundaries?.features || []).find(item => rings(item.geometry)
    .some(([outer, ...holes]) => outer && inRing(longitude, latitude, outer) && !holes.some(hole => inRing(longitude, latitude, hole))));
  return feature ? { name: feature.properties.name, pcode: feature.properties.pcode } : null;
}

// Every active responder account in the city.
const activeResponderUids = users => Object.entries(users || {})
  .filter(([, user]) => user?.role === 'RESPONDER' && user.active === true)
  .map(([uid]) => uid);

// One entry per distinct token for the given responders. Responders without a saved token are skipped.
function responderTokens(uids, tokenStore) {
  const seen = new Set();
  const result = [];
  for (const uid of uids) {
    const token = tokenStore?.[uid]?.fcmToken;
    if (typeof token !== 'string' || !token.trim() || seen.has(token)) continue;
    seen.add(token);
    result.push({ uid, token });
  }
  return result;
}

function alertMessage(incidentId, incident, barangay) {
  const label = TYPE_LABELS[normalizeIncidentType(incident.type)] || 'emergency';
  const address = typeof incident.location?.address === 'string' ? incident.location.address.trim().slice(0, MAX_ADDRESS_LENGTH) : '';
  const body = [`Brgy. ${barangay.name}`, address].filter(Boolean).join(' · ');
  return {
    notification: { title: `New ${label} alert`, body },
    // FCM data values must be strings. The app uses incidentId to open the alert.
    data: { incidentId: String(incidentId), type: String(incident.type || ''), priority: String(incident.priority || '') },
    android: { priority: 'high', notification: { channelId: ALERT_CHANNEL_ID } },
  };
}

const isDeadTokenError = code => DEAD_TOKEN_ERRORS.includes(code);

function chunk(items, size = MAX_TOKENS_PER_SEND) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export {
  MAX_ALERT_AGE_MS, ALERT_CHANNEL_ID, MAX_TOKENS_PER_SEND,
  skipReason, tabukBarangay, activeResponderUids, responderTokens, alertMessage, isDeadTokenError, chunk,
};
