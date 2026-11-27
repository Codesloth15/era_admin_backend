import { CITY } from '../config/data-paths.js';
import { fail, key } from './rules/agency.rules.js';

function createAgencyContext({ repository: repo, auth, files, roadRouting, id, now = Date.now }) {
  const profile = async uid => (await repo.read(`${CITY}/users/${uid}`)) ?? (await repo.read(`users/${uid}`));
  const permit = (actor, agencyId, systemOnly = false, stationAccess = false) => {
    if (stationAccess && !systemOnly && actor?.active === true && actor.role === 'COMMAND_ADMIN') return;
    if (actor?.active !== true || !['SYSTEM_ADMIN', 'AGENCY_ADMIN'].includes(actor.role)) fail('Administrator permission required.', 403);
    if (actor.role !== 'SYSTEM_ADMIN' && (systemOnly || actor.agencyId !== agencyId || actor.authProvisioned !== true)) fail('Access to this agency is denied.', 403);
  };
  async function actor(uid) {
    const value = await profile(uid);
    if (value?.role === 'COMMAND_ADMIN' && value.active === true) return value;
    if (value?.role === 'AGENCY_ADMIN') {
      permit(value, value.agencyId);
      if (!(await repo.read(`${CITY}/agency/${key(value.agencyId)}/profile/active`))) fail('Agency is inactive.', 403);
    } else permit(value, null, true);
    return value;
  }
  async function mutate(uid, agencyId, systemOnly, action, targetUid, change, stationAccess = false) {
    const operator = await actor(uid); permit(operator, agencyId, systemOnly, stationAccess);
    const auditId = id(); const timestamp = now();
    await repo.transact(CITY, state => {
      state ||= {};
      const current = state.users?.[uid] ?? operator;
      permit(current, agencyId, systemOnly, stationAccess);
      if (current.role === 'AGENCY_ADMIN' && !state.agency?.[current.agencyId]?.profile?.active) fail('Agency is inactive.', 403);
      change(state, current);
      state.command_center ||= {}; state.command_center.audit_logs ||= {};
      state.command_center.audit_logs[auditId] = { actorUid: uid, targetUid: targetUid || null, agencyId: agencyId || null, action, timestamp };
      return state;
    });
  }
  const pending = item => item.status.startsWith('PENDING_') && item.expiresAt > now();
  return { repo, auth, files, roadRouting, id, now, profile, permit, actor, mutate, pending };
}

export { createAgencyContext };
