// Sends a push notification to every active responder when a new warning is added.
const WARNINGS_PATH = 'server/City of Tabuk/warning';
const RESPONDERS_PATH = 'server/City of Tabuk/command_center/responder/active_responder';

export function startWarningNotifications(db, messaging) {
  const warningsRef = db.ref(WARNINGS_PATH);
  const respondersRef = db.ref(RESPONDERS_PATH);

  warningsRef.on('child_added', async (snapshot) => {
    const warning = snapshot.val();
    const warningId = snapshot.key;

    try {
      // Skip if already notified
      if (warning.notified) {
        console.log(`Warning ${warningId} already notified, skipping...`);
        return;
      }

      // Fetch all active responders
      const respondersSnapshot = await respondersRef.once('value');
      if (!respondersSnapshot.exists()) {
        console.warn('No active responders found, skipping notification');
        return;
      }

      // Collect all FCM tokens
      const tokens = [];
      respondersSnapshot.forEach((child) => {
        const responder = child.val();
        if (responder.fcmToken) {
          tokens.push(responder.fcmToken);
        }
      });

      if (tokens.length === 0) {
        console.warn('No FCM tokens found, skipping notification');
        return;
      }

      // Send notifications individually (works in all firebase-admin versions)
      for (const token of tokens) {
        const message = {
          notification: {
            title: warning.Warning ? warning.Warning.replace(/_/g, ' ') : 'Emergency Alert',
            body: warning.AreaName ? `Location: ${warning.AreaName}` : 'Check dashboard for details',
          },
          token,
        };

        try {
          await messaging.send(message);
          console.log(`✅ Notification sent to token: ${token}`);
        } catch (err) {
          console.error(`❌ Error sending notification to token ${token}:`, err);
        }
      }

      // Mark warning as notified
      await warningsRef.child(warningId).update({ notified: true });
      console.log(`⚡ Warning ${warningId} marked as notified`);
    } catch (err) {
      console.error(`❌ Error processing warning ${warningId}:`, err);
    }
  });
}
