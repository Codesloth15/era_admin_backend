import { CITY, PUSH_TOKENS, ALERT_NOTIFICATIONS } from '../config/data-paths.js';
import { skipReason, tabukBarangay, activeResponderUids, responderTokens, alertMessage, isDeadTokenError, chunk } from './rules/alert-notification.rules.js';

const ALREADY_CLAIMED = Symbol('already claimed');

// Pushes a new citizen alert to every active responder's phone, once, and only when the alert is inside Tabuk City.
// dependencies:
//   repository  read(path), transact(path, change), removeIf(path, shouldRemove)
//   push        send(message, tokens) -> [{ token, ok, errorCode }] in the same order as tokens
//   boundaries  Tabuk City barangay boundaries (GeoJSON FeatureCollection)
//   now         () => milliseconds
function createAlertNotifications({ repository, push, boundaries, now }) {
  // The send log entry is claimed first, so a restart or a second server never pushes the same alert twice.
  const claim = async (logPath, claimedAt) => {
    try {
      await repository.transact(logPath, current => {
        if (current) throw ALREADY_CLAIMED;
        return { status: 'SENDING', claimedAt };
      });
      return true;
    } catch (error) {
      if (error === ALREADY_CLAIMED) return false;
      throw error;
    }
  };

  // A token is removed only if the phone has not saved a newer one in the meantime.
  const removeDeadTokens = async recipients => {
    let removed = 0;
    for (const { uid, token } of recipients) {
      try {
        if (await repository.removeIf(`${PUSH_TOKENS}/${uid}`, saved => saved?.fcmToken === token)) removed += 1;
      } catch (error) {
        console.error('Alert push: a dead token could not be removed.', error?.code || error?.message);
      }
    }
    return removed;
  };

  const deliver = async (incidentId, incident) => {
    const barangay = tabukBarangay(incident.location, boundaries);
    if (!barangay) return { status: 'OUTSIDE_TABUK' };
    const [users, tokenStore] = await Promise.all([repository.read(`${CITY}/users`), repository.read(PUSH_TOKENS)]);
    const recipients = responderTokens(activeResponderUids(users), tokenStore);
    const area = { barangay: barangay.name, barangayCode: barangay.pcode };
    if (!recipients.length) return { status: 'NO_RECIPIENTS', ...area, recipients: 0 };

    const message = alertMessage(incidentId, incident, barangay);
    let successCount = 0;
    const dead = [];
    for (const group of chunk(recipients)) {
      const results = await push.send(message, group.map(recipient => recipient.token));
      results.forEach((result, index) => {
        if (result.ok) successCount += 1;
        else if (isDeadTokenError(result.errorCode)) dead.push(group[index]);
      });
    }
    const removedTokens = await removeDeadTokens(dead);
    return {
      status: successCount ? 'SENT' : 'FAILED', ...area,
      recipients: recipients.length, successCount, failureCount: recipients.length - successCount, removedTokens,
    };
  };

  return {
    // Called for each alert the backend sees. Returns what happened; never contains tokens.
    async notifyNewIncident(incidentId, incident) {
      const reason = skipReason(incident, now());
      if (reason) return { status: 'SKIPPED', reason };
      const logPath = `${ALERT_NOTIFICATIONS}/${incidentId}`;
      if (!(await claim(logPath, now()))) return { status: 'ALREADY_HANDLED' };

      let outcome;
      try {
        outcome = await deliver(incidentId, incident);
      } catch (error) {
        outcome = { status: 'FAILED', errorCode: String(error?.code || 'SEND_ERROR') };
      }
      const finishedAt = now();
      await repository.transact(logPath, current => ({ ...current, ...outcome, finishedAt }));
      return outcome;
    },
  };
}

export { createAlertNotifications };
