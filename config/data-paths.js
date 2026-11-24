const CITY = 'server/City of Tabuk';
// Citizen alerts (written by the citizen app).
const INCIDENTS = 'incidents';
// One push token per signed-in responder phone, written by the responder app: {uid}/fcmToken.
const PUSH_TOKENS = `${CITY}/command_center/responder/active_user`;
// Backend-only record of each alert's push notification: {incidentId}.
const ALERT_NOTIFICATIONS = `${CITY}/command_center/alert_notifications`;

export { CITY, INCIDENTS, PUSH_TOKENS, ALERT_NOTIFICATIONS };
