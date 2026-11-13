const { CITY } = require('../dataPaths.cjs');
const { fail, key } = require('../../domain/agencyRules.cjs');
const { COMMAND_CENTER, advisoryInput, advisoryImageInput, publicAdvisory } = require('../../domain/advisoryRules.cjs');

// Drafts live in advisories (backend only). Published advisories are copied to
// public_advisories, which signed-in citizens can read.
function createAdvisories(context) {
  const { repo, actor, files, id, now } = context;
  const removeFile = async path => { if (path && files) { try { await files.remove(path); } catch { /* an orphaned file is harmless */ } } };
  const commandRole = operator => ['SYSTEM_ADMIN', 'COMMAND_ADMIN'].includes(operator.role);
  const issuersOf = (operator, agencies = {}) => {
    if (!commandRole(operator)) {
      const agencyId = operator.agencyId;
      return [{ id: agencyId, name: agencies[agencyId]?.profile?.name || agencyId }];
    }
    return [{ id: COMMAND_CENTER, name: 'Command Center' }, ...Object.entries(agencies)
      .filter(([, agency]) => agency?.profile?.active === true)
      .map(([agencyId, agency]) => ({ id: agencyId, name: agency.profile.name || agencyId }))];
  };
  const inScope = (operator, advisory) => commandRole(operator) || advisory?.agencyId === operator.agencyId;
  const change = async (uid, action, advisoryId, update) => {
    const operator = await actor(uid);
    const timestamp = now(); const auditId = id();
    let result;
    await repo.transact(CITY, state => {
      state ||= {};
      result = update(state, operator, timestamp);
      state.command_center ||= {}; state.command_center.audit_logs ||= {};
      state.command_center.audit_logs[auditId] = { actorUid: uid, targetUid: null, resourceId: advisoryId, agencyId: operator.agencyId || null, action, timestamp };
      return state;
    });
    return result;
  };
  const EDITABLE = ['DRAFT', 'PUBLISHED'];
  const syncPublic = (state, advisoryId, advisory) => {
    if (advisory.status !== 'PUBLISHED') return;
    state.public_advisories ||= {};
    state.public_advisories[advisoryId] = publicAdvisory(advisory);
  };
  const existing = (state, operator, advisoryId) => {
    const advisory = state.advisories?.[advisoryId];
    if (!advisory || !inScope(operator, advisory)) fail('Advisory not found.', 404);
    return advisory;
  };

  return {
    async listAdvisories(uid) {
      const operator = await actor(uid);
      const [advisories, agencies] = await Promise.all([repo.read(`${CITY}/advisories`), repo.read(`${CITY}/agency`)]);
      const visible = Object.fromEntries(Object.entries(advisories || {}).filter(([, item]) => inScope(operator, item)));
      return { advisories: visible, issuers: issuersOf(operator, agencies || {}), now: now() };
    },
    // Drafts and published advisories can be edited. Editing a published advisory applies the
    // publishing checks and updates the citizen copy straight away. Archived ones must be
    // unarchived (back to a draft) first.
    async saveAdvisory(uid, input) {
      const draftDetails = advisoryInput(input);
      const advisoryId = input?.id ? key(input.id, 'advisory') : id();
      let livePublished = false;
      await change(uid, input?.id ? 'ADVISORY_UPDATED' : 'ADVISORY_DRAFT_CREATED', advisoryId, (state, operator, timestamp) => {
        const previous = input?.id ? existing(state, operator, advisoryId) : null;
        if (previous?.status === 'ARCHIVED') fail('Unarchive this advisory before editing it.', 409);
        livePublished = previous?.status === 'PUBLISHED';
        const details = livePublished ? advisoryInput(input, { publishing: true }) : draftDetails;
        if (livePublished && details.expiresAt && details.expiresAt <= timestamp) fail('The expiration time has already passed. Choose a later time or archive the advisory.');
        const issuer = issuersOf(operator, state.agency).find(item => item.id === details.agencyId);
        if (!issuer) fail('You can only issue advisories for your own agency.', 403);
        state.advisories ||= {};
        const advisory = livePublished
          ? { ...previous, ...details, agencyName: issuer.name, status: 'PUBLISHED', updatedBy: uid, updatedAt: timestamp }
          : {
            ...details, image: previous?.image || null, agencyName: issuer.name, status: 'DRAFT',
            createdBy: previous?.createdBy || uid, createdAt: previous?.createdAt || timestamp, updatedBy: uid, updatedAt: timestamp,
          };
        state.advisories[advisoryId] = advisory;
        if (livePublished) { state.public_advisories ||= {}; state.public_advisories[advisoryId] = publicAdvisory(advisory); }
      });
      return { id: advisoryId, message: livePublished ? 'Advisory updated. Citizens see the change now.' : 'Draft saved.' };
    },
    async publishAdvisory(uid, advisoryId) {
      advisoryId = key(advisoryId, 'advisory');
      await change(uid, 'ADVISORY_PUBLISHED', advisoryId, (state, operator, timestamp) => {
        const advisory = existing(state, operator, advisoryId);
        if (advisory.status !== 'DRAFT') fail('Only drafts can be published.', 409);
        const details = advisoryInput(advisory, { publishing: true });
        if (details.expiresAt && details.expiresAt <= timestamp) fail('The expiration time has already passed. Update the draft first.');
        const issuer = issuersOf(operator, state.agency).find(item => item.id === details.agencyId);
        if (!issuer) fail('You can only issue advisories for your own agency.', 403);
        Object.assign(advisory, details, { agencyName: issuer.name, status: 'PUBLISHED', issuedAt: timestamp, publishedBy: uid, publishedAt: timestamp, updatedBy: uid, updatedAt: timestamp });
        state.public_advisories ||= {};
        state.public_advisories[advisoryId] = publicAdvisory(advisory);
      });
      return { message: 'Advisory published. Citizens can now see it in the app.' };
    },
    async archiveAdvisory(uid, advisoryId) {
      advisoryId = key(advisoryId, 'advisory');
      await change(uid, 'ADVISORY_ARCHIVED', advisoryId, (state, operator, timestamp) => {
        const advisory = existing(state, operator, advisoryId);
        if (advisory.status !== 'PUBLISHED') fail('Only published advisories can be archived.', 409);
        Object.assign(advisory, { status: 'ARCHIVED', archivedBy: uid, archivedAt: timestamp, updatedBy: uid, updatedAt: timestamp });
        if (state.public_advisories) delete state.public_advisories[advisoryId];
      });
      return { message: 'Advisory archived and removed from the citizen app.' };
    },
    // Unarchiving returns the advisory to a draft so it can be reviewed (its expiry has
    // usually passed) and published again. It does not reappear in the citizen app by itself.
    async unarchiveAdvisory(uid, advisoryId) {
      advisoryId = key(advisoryId, 'advisory');
      await change(uid, 'ADVISORY_UNARCHIVED', advisoryId, (state, operator, timestamp) => {
        const advisory = existing(state, operator, advisoryId);
        if (advisory.status !== 'ARCHIVED') fail('Only archived advisories can be unarchived.', 409);
        Object.assign(advisory, { status: 'DRAFT', unarchivedBy: uid, unarchivedAt: timestamp, updatedBy: uid, updatedAt: timestamp });
      });
      return { message: 'Advisory moved back to drafts. Review it and publish it again.' };
    },
    async deleteAdvisory(uid, advisoryId) {
      advisoryId = key(advisoryId, 'advisory');
      const imagePath = await change(uid, 'ADVISORY_DRAFT_DELETED', advisoryId, (state, operator) => {
        const advisory = existing(state, operator, advisoryId);
        if (advisory.status !== 'DRAFT') fail('Only drafts can be deleted.', 409);
        delete state.advisories[advisoryId];
        return advisory.image?.path || null;
      });
      await removeFile(imagePath);
      return { message: 'Draft deleted.' };
    },
    // The cover image can change on drafts and on published advisories (the citizen copy follows).
    async uploadAdvisoryImage(uid, advisoryId, input) {
      advisoryId = key(advisoryId, 'advisory');
      const image = advisoryImageInput(input);
      const operator = await actor(uid);
      const current = await repo.read(`${CITY}/advisories/${advisoryId}`);
      if (!current || !inScope(operator, current)) fail('Advisory not found.', 404);
      if (!EDITABLE.includes(current.status)) fail('Images can only be changed on drafts and published advisories.', 409);
      if (!files) fail('Image storage is not configured.', 503);
      const path = `advisory-images/${advisoryId}/cover-${now()}.${image.ext}`;
      const url = await files.save(path, image.buffer, image.contentType);
      let previousPath = null;
      try {
        await change(uid, 'ADVISORY_IMAGE_UPDATED', advisoryId, (state, actorProfile, timestamp) => {
          const advisory = existing(state, actorProfile, advisoryId);
          if (!EDITABLE.includes(advisory.status)) fail('Images can only be changed on drafts and published advisories.', 409);
          previousPath = advisory.image?.path || null;
          advisory.image = { url, path, contentType: image.contentType, updatedAt: timestamp };
          advisory.updatedBy = uid; advisory.updatedAt = timestamp;
          syncPublic(state, advisoryId, advisory);
        });
      } catch (error) { await removeFile(path); throw error; }
      if (previousPath !== path) await removeFile(previousPath);
      return { imageUrl: url, message: 'Image uploaded.' };
    },
    async removeAdvisoryImage(uid, advisoryId) {
      advisoryId = key(advisoryId, 'advisory');
      const imagePath = await change(uid, 'ADVISORY_IMAGE_REMOVED', advisoryId, (state, operator, timestamp) => {
        const advisory = existing(state, operator, advisoryId);
        if (!EDITABLE.includes(advisory.status)) fail('Images can only be changed on drafts and published advisories.', 409);
        const path = advisory.image?.path || null;
        advisory.image = null; advisory.updatedBy = uid; advisory.updatedAt = timestamp;
        syncPublic(state, advisoryId, advisory);
        return path;
      });
      await removeFile(imagePath);
      return { message: 'Image removed.' };
    },
  };
}

module.exports = { createAdvisories };
