const { CITY } = require('../dataPaths.cjs');
const { fail, str, key, code, email, stationInput, responderInput, responderProfileInput } = require('../../domain/agencyRules.cjs');
const { requireAgencyDispatch, applyAgencyCommand, retiredRoleTargets, stationMapRecords } = require('../../domain/agencyRules.cjs');

const CLOSED_ASSIGNMENT_STATUSES = ['COMPLETED', 'CANCELLED', 'REJECTED', 'DECLINED', 'EXPIRED'];
const hasActiveAssignment = (state, teamId) => Object.values(state.dispatch_assignments || {})
  .some(item => item.incidentId && item.teamId === teamId && item.status && !CLOSED_ASSIGNMENT_STATUSES.includes(item.status));

function createAgencyManagement(context) {
  const { repo, auth, id, now, permit, actor, mutate, pending } = context;
  return {
    async stationDirectory(uid) {
      const operator = await actor(uid);
      const [legacy, shared, agencies] = await Promise.all([repo.read('stations'), repo.read(`${CITY}/stations`), repo.read(`${CITY}/agency`)]);
      return { data: stationMapRecords(legacy || {}, shared || {}, agencies || {}, operator.role === 'AGENCY_ADMIN' ? operator.agencyId : null) };
    },
    async consolidateAccountRole(uid) {
      const original = await context.profile(uid);
      if (!original || !retiredRoleTargets[original.role]) return { migrated: false };
      // The route uses the verified token UID, never a caller-supplied account ID.
      const account = await auth.getUser(uid);
      if (account.disabled || !account.email || (original.email && account.email.toLowerCase() !== original.email.toLowerCase())) fail('Unable to verify the existing account.', 403);
      const auditId = id();
      await repo.transact('/', state => {
        const city = state?.server?.['City of Tabuk'];
        const current = city?.users?.[uid] ?? state?.users?.[uid];
        const target = retiredRoleTargets[current?.role];
        if (!target) return state;
        const revoked = [state.admin_invitations, state.agency_invitations, city?.agency_invitations].some(collection => Object.values(collection || {}).some(item => item.uid === uid && item.status === 'REVOKED'));
        if (current.email && current.email.toLowerCase() !== account.email.toLowerCase()) fail('Account changed. Sign in again.', 409);
        if (target === 'AGENCY_ADMIN' && !city?.agency?.[current.agencyId]?.profile) fail('Agency setup is required before this account can be migrated.', 409);
        const migrate = value => {
          if (!value || !retiredRoleTargets[value.role]) return;
          value.role = retiredRoleTargets[value.role];
          if (value.role === 'AGENCY_ADMIN') value.authProvisioned = true;
          if (revoked) value.active = false;
        };
        migrate(state.users?.[uid]); migrate(city?.users?.[uid]);
        for (const agency of Object.values(city?.agency || {})) migrate(agency.members?.[uid]);
        for (const collection of [state.admin_invitations, state.agency_invitations, city?.agency_invitations]) {
          for (const item of Object.values(collection || {})) if (item.uid === uid) {
            if (retiredRoleTargets[item.role]) item.role = retiredRoleTargets[item.role];
            if (retiredRoleTargets[item.intendedRole]) item.intendedRole = retiredRoleTargets[item.intendedRole];
          }
        }
        state.audit_logs ||= {};
        state.audit_logs[auditId] = { action: 'ACCOUNT_ROLE_CONSOLIDATED', actorId: uid, resourceId: uid, role: target, timestamp: now() };
        return state;
      });
      return { migrated: true };
    },
    async ownerSession(uid) {
      const user = await actor(uid); permit(user, null, true);
      return { profile: { displayName: user.displayName || 'Owner', email: user.email || '', role: user.role, active: user.active }, serverName: 'City of Tabuk' };
    },
    async ownerList(uid) {
      permit(await actor(uid), null, true);
      return this.list(uid);
    },
    async createAgencyAdmin(uid, agencyId, input) {
      agencyId = code(agencyId);
      permit(await actor(uid), agencyId, true);
      const details = responderInput({ ...input, role: 'RESPONDER' });
      const validate = state => {
        const agency = state.agency?.[agencyId];
        if (!agency?.profile?.active) fail('An active agency is required.');
        if (details.stationId && !agency.stations?.[details.stationId]) fail('Station does not belong to this agency.');
        if (Object.values(state.users || {}).some(user => user.email?.toLowerCase() === details.email)
          || Object.values(state.agency_invitations || {}).some(item => item.email === details.email && (pending(item) || item.status === 'ACTIVE'))) fail('An account or invitation already exists for this email.', 409);
        return agency;
      };
      validate({ agency: { [agencyId]: await repo.read(`${CITY}/agency/${agencyId}`) }, users: await repo.read(`${CITY}/users`), agency_invitations: await repo.read(`${CITY}/agency_invitations`) });
      let account;
      try { account = await auth.createUser({ email: details.email, displayName: details.displayName, password: input.password, emailVerified: false }); }
      catch (error) {
        if (error.code === 'auth/email-already-exists') fail('This email already has a Firebase account. Use the invitation flow to link an existing account.', 409);
        if (['auth/invalid-password', 'auth/password-does-not-meet-requirements'].includes(error.code) || /PASSWORD_DOES_NOT_MEET_REQUIREMENTS/.test(error.message || '')) fail('Password does not meet the Firebase password requirements.');
        if (error.code === 'auth/invalid-email') fail('Invalid email.');
        throw error;
      }
      const targetUid = key(account.uid, 'Firebase Auth UID');
      const user = { ...details, role: 'AGENCY_ADMIN', agencyId, authProvisioned: true, createdBy: uid, createdAt: now(), approvedBy: uid, approvedAt: now() };
      try {
        await mutate(uid, agencyId, true, 'AGENCY_ADMIN_CREATED', targetUid, state => {
          const agency = validate(state); state.users ||= {}; agency.members ||= {};
          if (state.users[targetUid] || agency.members[targetUid]) fail('Existing account cannot be overwritten.', 409);
          state.users[targetUid] = user; agency.members[targetUid] = user;
        });
      } catch (error) {
        let saved;
        try { saved = await repo.read(`${CITY}/users/${targetUid}`); }
        catch { fail('Unable to confirm account creation. Check the Firebase account before retrying.', 503); }
        if (saved?.createdBy !== uid || saved?.role !== 'AGENCY_ADMIN' || saved?.agencyId !== agencyId || saved?.email !== details.email) {
          try { await auth.deleteUser(targetUid); }
          catch { fail('Account data could not be saved or the new login removed. Resolve the Firebase account before retrying.', 503); }
          throw error;
        }
      }
      return { uid: targetUid, agencyId, message: 'Agency administrator account created. Share the initial credentials securely. No email was sent.' };
    },
    async agencyDispatchData(uid, collection) {
      const state = await repo.read('/');
      const user = requireAgencyDispatch(state || {}, uid);
      const own = item => item.agencyId === user.agencyId;
      const filter = (items, predicate) => Object.fromEntries(Object.entries(items || {}).filter(([id, item]) => item && predicate(item, id)));
      const incidents = filter(state.incidents, () => true);
      const agency = state.server['City of Tabuk'].agency[user.agencyId];
      const teams = { ...filter(state.teams, own) };
      for (const [id, team] of Object.entries(agency.teams || {})) if (team && typeof team === 'object') teams[id] = { ...teams[id], ...team, agencyId: user.agencyId };
      const staff = filter({ ...state.users, ...state.server['City of Tabuk'].users }, own);
      for (const [id, member] of Object.entries(agency.members || {})) if (member && typeof member === 'object' && (!member.agencyId || own(member))) staff[id] = { ...staff[id], ...member, agencyId: user.agencyId };
      // Shared pages need names and assignments, not private profile metadata.
      const users = Object.fromEntries(Object.entries(staff).map(([id, member]) => [id, Object.fromEntries(['displayName', 'email', 'role', 'agencyId', 'stationId', 'teamId', 'active'].filter(field => member[field] !== undefined).map(field => [field, member[field]]))]));
      const assignments = filter(state.dispatch_assignments, own);
      const stations = stationMapRecords(state.stations || {}, state.server['City of Tabuk'].stations || {}, state.server['City of Tabuk'].agency, user.agencyId);
      const collections = {
        incidents, teams, agencies: { [user.agencyId]: { ...state.agencies?.[user.agencyId], ...agency.profile } },
        stations, 'server/City of Tabuk/stations': stations,
        responder_locations: filter(state.responder_locations, (_, id) => Boolean(teams[id])),
        dispatch_assignments: assignments,
        users,
        notification_jobs: filter(state.notification_jobs, job => job.targetType === 'TEAM' && Boolean(teams[job.targetId]) && (!job.assignmentId || Boolean(assignments[job.assignmentId]))),
        'server/City of Tabuk/shared_locations': filter(state.server['City of Tabuk'].shared_locations, (_, id) => Boolean(users[id])),
        incident_events: filter(state.incident_events, (_, id) => Boolean(incidents[id])),
        system_config: { dispatch: state.system_config?.dispatch || {}, environment: state.system_config?.environment || 'LIVE' },
        [`server/City of Tabuk/agency/${user.agencyId}/profile`]: agency.profile,
      };
      if (!Object.prototype.hasOwnProperty.call(collections, collection)) fail('Unsupported dispatch collection.', 403);
      return { data: collections[collection] };
    },
    async agencyDispatchCommand(uid, input) {
      const ids = { assignmentId: id(), eventId: id(), jobId: id(), auditId: id() };
      const timestamp = now();
      await repo.transact('/', state => applyAgencyCommand(state || {}, uid, input, ids, timestamp));
      return { message: 'Agency dispatch command saved.' };
    },
    async createResponder(uid, agencyId, input) {
      agencyId = code(agencyId);
      permit(await actor(uid), agencyId);
      const details = { ...responderInput(input), ...responderProfileInput(input) };
      const validateAgency = state => {
        const agency = state.agency?.[agencyId];
        if (!agency?.profile?.active) fail('An active agency is required.');
        if (details.stationId && !agency.stations?.[details.stationId]) fail('Station does not belong to this agency.');
        if (Object.values(state.users || {}).some(user => user.email?.toLowerCase() === details.email)) {
          fail('This email already has an account.', 409);
        }
        if (Object.values(state.agency_invitations || {}).some(item => item.email === details.email && (pending(item) || item.status === 'ACTIVE'))) {
          fail('An invitation already exists for this email.', 409);
        }
        return agency;
      };
      // Check before creating Auth, then recheck in the atomic database mutation.
      const [agency, users, invitations] = await Promise.all([
        repo.read(`${CITY}/agency/${agencyId}`),
        repo.read(`${CITY}/users`),
        repo.read(`${CITY}/agency_invitations`),
      ]);
      validateAgency({ agency: { [agencyId]: agency }, users, agency_invitations: invitations });
      let account;
      try {
        account = await auth.createUser({
          email: details.email,
          password: input.password,
          displayName: details.displayName,
          emailVerified: false,
        });
      } catch (error) {
        if (error.code === 'auth/email-already-exists') fail('This email already has a Firebase account.', 409);
        // Some Firebase Admin responses wrap password-policy failures as internal errors.
        if (error.code === 'auth/internal-error' && /PASSWORD_DOES_NOT_MEET_REQUIREMENTS/.test(error.message || '')) {
          const requirements = /Missing password requirements: \[([^\]]{1,500})\]/.exec(error.message)?.[1];
          fail('Password does not meet Firebase requirements.' + (requirements ? ' ' + requirements : ' Follow the project password policy.'));
        }
        if (['auth/invalid-password', 'auth/password-does-not-meet-requirements'].includes(error.code)) {
          fail('Password does not meet the Firebase password requirements.');
        }
        if (error.code === 'auth/invalid-email') fail('Invalid email.');
        throw error;
      }
      const targetUid = key(account.uid, 'Firebase Auth UID');
      const user = {
        ...details, role: 'RESPONDER', agencyId, authProvisioned: true,
        createdBy: uid, createdAt: now(), approvedBy: uid, approvedAt: now(),
      };
      try {
        await mutate(uid, agencyId, false, 'RESPONDER_CREATED', targetUid, state => {
          const agency = validateAgency(state);
          state.users ||= {};
          if (state.users[targetUid] || agency.members?.[targetUid] || agency.responders?.[targetUid]) {
            fail('Existing account cannot be overwritten.', 409);
          }
          state.users[targetUid] = user;
          agency.members ||= {};
          agency.members[targetUid] = user;
          agency.responders ||= {};
          agency.responders[targetUid] = { memberUid: targetUid, active: user.active };
        });
      } catch (error) {
        // Auth and Realtime Database cannot share a transaction. Confirm whether
        // a failed response actually committed before removing the new Auth user.
        let saved;
        try {
          saved = await repo.read(`${CITY}/users/${targetUid}`);
        } catch {
          fail('Unable to confirm responder registration. Ask your System Administrator to check the account before retrying.', 503);
        }
        if (saved?.createdBy !== uid || saved?.agencyId !== agencyId || saved?.role !== 'RESPONDER' || saved?.email !== details.email) {
          try {
            await auth.deleteUser(targetUid);
          } catch {
            fail('Responder data could not be saved and the new Firebase account could not be removed. Ask your System Administrator to resolve the account before retrying.', 503);
          }
          throw error;
        }
      }
      return { uid: targetUid, agencyId, message: 'Responder account created. Share the initial credentials securely. No email has been sent.' };
    },
    async list(uid) {
      const operator = await actor(uid);
      const agencyIds = ['SYSTEM_ADMIN', 'COMMAND_ADMIN'].includes(operator.role)
        ? Object.keys(await repo.read(`${CITY}/agency`) || {}) : [operator.agencyId];
      // Membership records hold role and status only; names and emails live on the user profiles.
      const profiles = await repo.read(`${CITY}/users`) || {};
      const withProfiles = members => Object.fromEntries(Object.entries(members || {}).map(([memberUid, member]) => [memberUid, {
        ...member, displayName: member?.displayName || profiles[memberUid]?.displayName || '', email: member?.email || profiles[memberUid]?.email || '',
      }]));
      const agencies = await Promise.all(agencyIds.map(async agencyId => {
        const agency = await repo.read(`${CITY}/agency/${agencyId}`);
        return { ...agency?.profile, id: agencyId, stations: agency?.stations || {}, teams: agency?.teams || {}, members: withProfiles(agency?.members) };
      }));
      // Invitations are private and served only after checking agency membership.
      const invitations = Object.entries(await repo.read(`${CITY}/agency_invitations`) || {})
        .filter(([, item]) => operator.role === 'SYSTEM_ADMIN' || (operator.role !== 'COMMAND_ADMIN' && item.agencyId === operator.agencyId))
        .map(([id, item]) => ({ ...item, role: retiredRoleTargets[item.role] || item.role, id, status: item.status.startsWith('PENDING_') && !pending(item) ? 'EXPIRED' : item.status }));
      return { agencies, invitations };
    },
    async createAgency(uid, input) {
      const agencyId = code(input.code);
      if (input.active !== undefined && typeof input.active !== 'boolean') fail('Agency status must be a boolean.');
      if (agencyId === 'CDRRMO' && ((await repo.read('agencies/CDRRMC')) || (await repo.read('agency/CDRRMC')))) fail('Legacy CDRRMC exists. Migrate it before creating CDRRMO.', 409);
      const agency = { name: str(input.name, 'agency name'), code: agencyId, type: str(input.type, 'agency type'),
        description: str(input.description || '', 'description', false), contactEmail: email(input.contactEmail),
        contactNumber: str(input.contactNumber, 'contact number'), address: str(input.address, 'office address'),
        active: input.active !== false, createdAt: now(), createdBy: uid };
      let station;
      if (input.station?.name) station = stationInput(input.station);
      await mutate(uid, agencyId, true, 'AGENCY_CREATED', null, state => {
        state.agency ||= {};
        if (state.agency[agencyId]) fail('Agency ID already exists.', 409);
        if (agencyId === 'CDRRMO' && state.agency.CDRRMC) fail('Legacy CDRRMC exists. Migrate it before creating CDRRMO.', 409);
        state.agency[agencyId] = { profile: agency, ...(station ? { stations: { [`${agencyId}_INITIAL`]: station } } : {}) };
      });
      return { id: agencyId, message: 'Agency created. You may now add an administrator.' };
    },
    async updateResponderProfile(uid, agencyId, targetUid, input) {
      agencyId = code(agencyId); targetUid = key(targetUid, 'responder');
      const personal = responderProfileInput(input);
      await mutate(uid, agencyId, false, 'RESPONDER_PROFILE_UPDATED', targetUid, state => {
        const agency = state.agency?.[agencyId];
        const user = state.users?.[targetUid];
        if (!agency || !user || user.agencyId !== agencyId || user.role !== 'RESPONDER') fail('Responder does not belong to this agency.', 403);
        Object.assign(user, personal, { updatedAt: now() });
        agency.members ||= {};
        agency.members[targetUid] = { ...agency.members[targetUid], ...personal };
      });
      return { message: 'Responder details updated.' };
    },
    async status(uid, agencyId, input) {
      agencyId = code(agencyId); const targetUid = input.uid ? key(input.uid) : null;
      if (typeof input.active !== 'boolean') fail('Active must be a boolean.');
      await mutate(uid, agencyId, !targetUid, targetUid ? 'MEMBER_STATUS_CHANGED' : 'AGENCY_STATUS_CHANGED', targetUid, (state, operator) => {
        const agency = state.agency?.[agencyId];
        if (!agency) fail('Agency not found.', 404);
        if (!targetUid) { agency.profile.active = input.active; return; }
        const user = state.users?.[targetUid];
        if (!user || user.agencyId !== agencyId || !agency.members?.[targetUid]) fail('Member does not belong to this agency.', 403);
        if (operator.role !== 'SYSTEM_ADMIN' && user.role !== 'RESPONDER') fail('System administrator required for privileged accounts.', 403);
        if (uid === targetUid) fail('You cannot change your own status.');
        if (input.active && !agency.profile.active) fail('Activate the agency first.');
        if (input.active && Object.values(state.agency_invitations || {}).some(item => item.uid === targetUid && item.status === 'REVOKED')) fail('Revoked accounts require a new authorization process.');
        user.active = input.active; agency.members[targetUid].active = input.active;
        if (agency.responders?.[targetUid]) agency.responders[targetUid].active = input.active;
      });
      return { message: 'Status updated.' };
    },
    async saveResource(uid, agencyId, collection, input) {
      agencyId = code(agencyId);
      if (!['stations', 'teams'].includes(collection)) fail('Unsupported collection.');
      // Readiness toggles send only { id, active } or { id, status }. A request carrying a
      // team name is a details edit (name/station), even if the client includes other team fields.
      if (collection === 'teams' && input.name === undefined && (input.active !== undefined || input.status !== undefined)) {
        const teamId = key(input.id, 'team ID');
        if (input.active !== undefined && typeof input.active !== 'boolean') fail('Active must be a boolean.');
        if (input.status !== undefined && !['AVAILABLE', 'UNAVAILABLE'].includes(input.status)) fail('Invalid team readiness.');
        const auditId = id(); const timestamp = now();
        await repo.transact('/', state => {
          const city = state?.server?.['City of Tabuk'];
          permit(city?.users?.[uid] ?? state?.users?.[uid], agencyId);
          const agency = city?.agency?.[agencyId];
          if (agency?.profile?.active !== true) fail('An active agency is required.');
          const legacy = state.teams?.[teamId];
          const canonical = agency.teams?.[teamId];
          if ((!canonical && !legacy) || (legacy && legacy.agencyId !== agencyId)) fail('Team does not belong to this agency.', 403);
          const team = { ...legacy, ...canonical, agencyId };
          if (hasActiveAssignment(state, teamId)) fail('Finish the active assignment before changing team readiness.');
          if (input.active !== undefined) team.active = input.active;
          if (input.status === 'AVAILABLE' && team.active !== true) fail('Activate the team before making it available.');
          team.status = team.active !== true ? 'UNAVAILABLE' : input.status || (['AVAILABLE', 'UNAVAILABLE'].includes(team.status) ? team.status : 'UNAVAILABLE');
          team.updatedAt = timestamp;
          state.teams ||= {}; agency.teams ||= {};
          state.teams[teamId] = team; agency.teams[teamId] = { ...team };
          city.command_center ||= {}; city.command_center.audit_logs ||= {};
          city.command_center.audit_logs[auditId] = { actorUid: uid, agencyId, resourceId: teamId, action: 'TEAM_READINESS_UPDATED', timestamp };
          return state;
        });
        return { message: 'Team readiness updated.' };
      }
      const resourceId = input.id ? key(input.id) : id();
      const value = collection === 'stations' ? stationInput(input) : { name: str(input.name, 'team name'), stationId: input.stationId ? key(input.stationId) : null };
      if (collection === 'teams') {
        const auditId = id(); const timestamp = now();
        // Root scope: the active-assignment check and the responder cascade must commit together.
        await repo.transact('/', state => {
          const city = state?.server?.['City of Tabuk'];
          permit(city?.users?.[uid] ?? state?.users?.[uid], agencyId);
          const agency = city?.agency?.[agencyId];
          if (agency?.profile?.active !== true) fail('An active agency is required.');
          if (value.stationId && !agency.stations?.[value.stationId]) fail('Invalid agency station.');
          agency.teams ||= {};
          const existing = agency.teams[resourceId];
          const fromStationId = existing?.stationId || null;
          const moved = Boolean(existing) && fromStationId !== value.stationId;
          const responderUids = [];
          if (moved) {
            if (hasActiveAssignment(state, resourceId)) fail('Team is on an active assignment. Finish it before changing the team station.');
            const users = city.users || {};
            const uids = new Set([
              ...Object.keys(users).filter(memberUid => users[memberUid]?.teamId === resourceId && users[memberUid].agencyId === agencyId),
              ...Object.keys(agency.members || {}).filter(memberUid => agency.members[memberUid]?.teamId === resourceId),
            ]);
            for (const memberUid of uids) {
              if (users[memberUid]?.agencyId === agencyId) users[memberUid].stationId = value.stationId;
              if (agency.members?.[memberUid]) agency.members[memberUid].stationId = value.stationId;
              if (agency.responders?.[memberUid]) agency.responders[memberUid].stationId = value.stationId;
              responderUids.push(memberUid);
            }
            if (state.teams?.[resourceId]?.agencyId === agencyId) state.teams[resourceId].stationId = value.stationId;
          }
          // Preserve operational fields on existing teams.
          agency.teams[resourceId] = { ...existing, ...value, updatedAt: timestamp };
          city.command_center ||= {}; city.command_center.audit_logs ||= {};
          city.command_center.audit_logs[auditId] = moved
            ? { actorUid: uid, agencyId, resourceId, action: 'TEAM_STATION_TRANSFERRED', fromStationId, toStationId: value.stationId, responderUids, timestamp }
            : { actorUid: uid, targetUid: null, agencyId, action: 'TEAMS_SAVED', timestamp };
          return state;
        });
        return { message: 'Team saved.' };
      }
      await mutate(uid, agencyId, false, 'STATIONS_SAVED', null, state => {
        const agency = state.agency?.[agencyId];
        if (!agency?.profile?.active) fail('An active agency is required.');
        agency.stations ||= {};
        // Preserve operational fields on existing stations.
        agency.stations[resourceId] = { ...agency.stations[resourceId], ...value, updatedAt: now() };
      }, true);
      return { message: 'Station saved.' };
    },
    async assignStation(uid, agencyId, input) {
      agencyId = code(agencyId);
      const targetUid = key(input.uid, 'responder UID');
      const stationId = input.stationId ? key(input.stationId, 'station ID') : null;
      await mutate(uid, agencyId, false, 'RESPONDER_STATION_ASSIGNED', targetUid, state => {
        const agency = state.agency?.[agencyId];
        if (!agency?.profile?.active) fail('An active agency is required.');
        const user = state.users?.[targetUid];
        const member = agency.members?.[targetUid];
        if (user?.role !== 'RESPONDER' || user.agencyId !== agencyId || member?.role !== 'RESPONDER' || member.agencyId !== agencyId) fail('Responder does not belong to this agency.', 403);
        if (stationId && !agency.stations?.[stationId]) fail('Station does not belong to this agency.');
        if (user.teamId && agency.teams?.[user.teamId]?.stationId && agency.teams[user.teamId].stationId !== stationId) fail('Responder team belongs to another station. Update the team assignment first.');
        user.stationId = stationId;
        member.stationId = stationId;
        if (agency.responders?.[targetUid]) agency.responders[targetUid].stationId = stationId;
      }, true);
      return { message: 'Responder station assignment saved.' };
    },
  };
}

module.exports = { createAgencyManagement };
