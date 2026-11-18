import { CITY } from '../config/data-paths.js';
import { fail, key } from './rules/agency.rules.js';

function createAccountLocation(context) {
  const { repo, profile } = context;
  return {
    async accountStation(uid) {
      const user = await profile(uid);
      if (user?.active !== true || !['SYSTEM_ADMIN', 'COMMAND_ADMIN', 'AGENCY_ADMIN'].includes(user.role)
        || (user.role === 'AGENCY_ADMIN' && user.authProvisioned !== true)) fail('Approved account required.', 403);
      const agencyId = user.agencyId ? key(user.agencyId, 'agency') : null;
      if (!agencyId && !['SYSTEM_ADMIN', 'COMMAND_ADMIN'].includes(user.role)) fail('Agency assignment is required.', 403);
      const agency = agencyId ? await repo.read(CITY + '/agency/' + agencyId + '/profile') : null;
      const legacyAgency = agencyId && !agency ? await repo.read('agencies/' + agencyId) : null;
      if (agency?.active === false || legacyAgency?.active === false) fail('Agency is inactive.', 403);
      let assigned = user.stationId;
      if (!assigned && user.teamId) {
        const teamId = key(user.teamId, 'assigned team');
        const team = (agencyId ? await repo.read(CITY + '/agency/' + agencyId + '/teams/' + teamId) : null) ?? await repo.read('teams/' + teamId);
        if (team && (!team.agencyId || team.agencyId === agencyId)) assigned = team.stationId;
      }
      if (!assigned) assigned = agency?.primaryStationId || legacyAgency?.primaryStationId;
      if (!assigned && agencyId) {
        const canonicalStations = await repo.read(CITY + '/agency/' + agencyId + '/stations') || {};
        const legacyStations = { ...(await repo.read('stations') || {}), ...(await repo.read(CITY + '/stations') || {}) };
        const resolvedCanonical = Object.fromEntries(Object.entries(canonicalStations).map(([id, value]) => [id, value && typeof value === 'object' ? value : legacyStations[id]]));
        const own = { ...Object.fromEntries(Object.entries(legacyStations).filter(([, item]) => item?.agencyId === agencyId)), ...resolvedCanonical };
        const candidates = Object.entries(own).filter(([, item]) => item?.active !== false);
        if (candidates.length === 1) assigned = candidates[0][0];
        else if (candidates.length > 1) fail('Your agency has multiple stations. Ask your System Administrator to assign a stationId to your account.');
        else fail('No station is assigned to your account and no station is registered for your agency. Ask your System Administrator to configure your station.');
      }
      if (!assigned) return { location: null };
      const stationId = key(assigned, 'assigned station');

      // Stations created by the Command Center or System Administrators are kept apart from agency stations.
      const commandStation = user.stationSource === 'COMMAND_CENTER' ? await repo.read(CITY + '/command_stations/' + stationId) : null;
      const canonical = agencyId ? await repo.read(CITY + '/agency/' + agencyId + '/stations/' + stationId) : null;
      const shared = await repo.read(CITY + '/stations/' + stationId);
      const station = commandStation && typeof commandStation === 'object' ? commandStation : canonical && typeof canonical === 'object' ? canonical : shared ?? await repo.read('stations/' + stationId);
      if (!station) fail('Your assigned station was not found.', 404);
      if (!commandStation && ((!canonical && agencyId && station.agencyId !== agencyId) || (station.agencyId && agencyId && station.agencyId !== agencyId))) fail('Assigned station does not belong to your agency.', 403);
      if (station.active === false) fail('Your assigned station is inactive.', 403);
      const point = station.location && typeof station.location === 'object' ? station.location : station;
      const latitude = Number.isFinite(point.latitude) ? point.latitude : station.latitude;
      const longitude = Number.isFinite(point.longitude) ? point.longitude : station.longitude;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) fail('Your assigned station has no valid coordinates.');
      return { location: { stationId, agencyId: agencyId || station.agencyId || null,
        displayLabel: point.displayLabel || station.name || stationId, latitude, longitude,
        source: 'STATION', isSimulated: station.isSimulation === true || station.isSimulated === true || point.isSimulated === true || point.isSimulation === true || point.source === 'SIMULATION_ONLY' } };
    },
  };
}

export { createAccountLocation };
