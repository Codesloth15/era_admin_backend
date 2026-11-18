import { CITY } from '../config/data-paths.js';
import { roles, retiredRoleTargets, fail, str, key, code, email } from './rules/agency.rules.js';

function createInvitations(context) {
  const { repo, auth, id, now, permit, actor, mutate, pending } = context;
  return {
    async invite(uid, agencyId, input) {
      agencyId = code(agencyId);
      if (input.active !== undefined && typeof input.active !== 'boolean') fail('Account status must be a boolean.');
      const invitationId = id(); const role = input.role || 'AGENCY_ADMIN';
      if (!roles.includes(role)) fail('Unsupported role.');
      const invitation = { agencyId, displayName: str(input.displayName, 'full name'), email: email(input.email), role,
        stationId: input.stationId ? key(input.stationId) : null, requestedActive: input.active !== false,
        status: 'PENDING_AUTH_PROVISIONING', createdBy: uid, createdAt: now(), expiresAt: now() + 7 * 86400000 };
      const legacyAuth = await auth.getUserByEmail(invitation.email).catch(error => { if (error.code === 'auth/user-not-found') return null; throw error; });
      if (legacyAuth && await repo.read(`users/${key(legacyAuth.uid)}`)) fail('Existing legacy account cannot be reassigned.', 409);
      await mutate(uid, agencyId, role !== 'RESPONDER', 'INVITATION_CREATED', null, state => {
        const agency = state.agency?.[agencyId];
        if (!agency?.profile?.active) fail('An active agency is required.');
        if (invitation.stationId && !agency.stations?.[invitation.stationId]) fail('Station does not belong to this agency.');
        if (Object.values(state.users || {}).some(item => item.email?.toLowerCase() === invitation.email)) fail('This email already has an account.', 409);
        if (Object.values(state.agency_invitations || {}).some(item => item.email === invitation.email && (pending(item) || item.status === 'ACTIVE'))) fail('An invitation already exists for this email.', 409);
        state.agency_invitations ||= {}; state.agency_invitations[invitationId] = invitation;
      });
      return { id: invitationId, message: 'Invitation recorded. No email has been sent.' };
    },
    async provision(uid, invitationId, input) {
      invitationId = key(invitationId); const targetUid = key(input.uid, 'Firebase Auth UID');
      permit(await actor(uid), null, true);
      const account = await auth.getUser(targetUid);
      if (account.disabled || !account.emailVerified || !account.email) fail('Firebase account must be enabled with a verified email.');
      if (await repo.read(`users/${targetUid}`)) fail('Existing legacy accounts cannot be overwritten.', 409);
      await mutate(uid, null, true, 'INVITATION_UID_LINKED', targetUid, state => {
        const invitation = state.agency_invitations?.[invitationId];
        if (!invitation || invitation.status !== 'PENDING_AUTH_PROVISIONING' || !pending(invitation)) fail('Invitation is not pending or has expired.', 409);
        if (invitation.email !== account.email.toLowerCase()) fail('Firebase Auth email does not match the invitation.');
        if (state.users?.[targetUid] || Object.values(state.agency_invitations || {}).some(item => item.uid === targetUid && (pending(item) || item.status === 'ACTIVE'))) fail('UID is already assigned.', 409);
        invitation.uid = targetUid; invitation.status = 'PENDING_APPROVAL';
      });
      return { message: 'Verified UID linked. Administrator approval is still required.' };
    },
    async invitationAction(uid, invitationId, action) {
      invitationId = key(invitationId);
      if (!['approve', 'revoke'].includes(action)) fail('Invalid action.');
      permit(await actor(uid), null, true);
      const original = await repo.read(`${CITY}/agency_invitations/${invitationId}`);
      if (!original) fail('Invitation not found.', 404);
      if (action === 'approve') {
        if (!original.uid) fail('Link a real Auth UID first.');
        const account = await auth.getUser(original.uid);
        if (account.disabled || !account.emailVerified || account.email?.toLowerCase() !== original.email) fail('Firebase account no longer matches the invitation.');
        if (await repo.read(`users/${original.uid}`)) fail('Existing legacy account cannot be overwritten.', 409);
      }
      await mutate(uid, original.agencyId, true, `INVITATION_${action.toUpperCase()}`, original.uid, state => {
        const invitation = state.agency_invitations?.[invitationId];
        if (!invitation || ['REVOKED', 'EXPIRED'].includes(invitation.status)) fail('Invitation is no longer available.', 409);
        if (action === 'approve') {
          if (invitation.status !== 'PENDING_APPROVAL' || !pending(invitation)) fail('Invitation is not awaiting approval or has expired.', 409);
          const agency = state.agency?.[invitation.agencyId];
          if (!agency?.profile?.active) fail('Agency is inactive.');
          if (invitation.stationId && !agency.stations?.[invitation.stationId]) fail('Station no longer exists.');
          state.users ||= {};
          if (state.users[invitation.uid]) fail('Existing account cannot be overwritten.', 409);
          const user = { displayName: invitation.displayName, email: invitation.email, role: retiredRoleTargets[invitation.role] || invitation.role, agencyId: invitation.agencyId,
            stationId: invitation.stationId, active: invitation.requestedActive, authProvisioned: true, approvedBy: uid, approvedAt: now() };
          state.users[invitation.uid] = user; agency.members ||= {}; agency.members[invitation.uid] = user;
          if (user.role === 'RESPONDER') { agency.responders ||= {}; agency.responders[invitation.uid] = { memberUid: invitation.uid, active: user.active }; }
          invitation.role = user.role; invitation.status = 'ACTIVE';
        } else {
          invitation.status = 'REVOKED'; invitation.revokedAt = now();
          if (invitation.uid && state.users?.[invitation.uid]) {
            state.users[invitation.uid].active = false;
            if (state.agency?.[invitation.agencyId]?.responders?.[invitation.uid]) state.agency[invitation.agencyId].responders[invitation.uid].active = false;
            if (state.agency?.[invitation.agencyId]?.members?.[invitation.uid]) state.agency[invitation.agencyId].members[invitation.uid].active = false;
          }
        }
      });
      return { message: action === 'approve' ? 'Account approved.' : 'Invitation and account access revoked.' };
    },
  };
}

export { createInvitations };
