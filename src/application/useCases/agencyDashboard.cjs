const { CITY } = require('../dataPaths.cjs');
const { fail, key } = require('../../domain/agencyRules.cjs');

function createAgencyDashboard(context) {
  const { repo, actor } = context;
  return {
    async dashboard(uid) {
      const operator = await actor(uid);
      if (operator.role !== 'AGENCY_ADMIN') fail('Agency administrator required.', 403);
      const agency = await repo.read(`${CITY}/agency/${operator.agencyId}`);
      const canonical = await repo.read(`${CITY}/command_center/incident_feed`);
      const feed = canonical ?? (await repo.read('incidents')) ?? {};
      const resolvedFeed = canonical ? Object.fromEntries(await Promise.all(Object.entries(feed).map(async ([id, reference]) => {
        const incidentId = typeof reference === 'object' && reference?.incidentId ? key(reference.incidentId) : key(id);
        const original = await repo.read(`${CITY}/command_center/incidents/${incidentId}`);
        return [id, original || reference];
      }))) : feed;
      // A read-only summary excludes citizen contact details and simulated operations.
      const live = Object.fromEntries(Object.entries(resolvedFeed).filter(([, entry]) => entry && entry.isSimulation !== true)
        .map(([id, entry]) => [id, { incidentId: entry.incidentId || id, title: entry.title || '', type: entry.type || entry.emergencyType || '', locationName: entry.locationName || entry.location?.address || '', status: entry.status || 'REPORTED', createdAt: entry.createdAt || null }]));
      // Membership records may hold role and status only; show names, contact and personal details from profiles.
      const profiles = await repo.read(`${CITY}/users`) || {};
      const fields = ['displayName', 'email', 'phoneNumber', 'residentialAddress', 'birthdate', 'sex', 'emergencyContactName', 'emergencyContactPhone', 'stationId'];
      const members = Object.fromEntries(Object.entries(agency?.members || {}).map(([memberUid, member]) => [memberUid,
        { ...member, ...Object.fromEntries(fields.map(field => [field, member?.[field] || profiles[memberUid]?.[field] || ''])) }]));
      return { agency: agency ? { ...agency, members } : agency, feed: live };
    },
  };
}

module.exports = { createAgencyDashboard };
