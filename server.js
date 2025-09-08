const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const cors = require('cors');
require('dotenv').config();

const serviceAccount = require('./firebase/serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.REACT_APP_FIREBASE_DATABASE_URL,
});

const app = express();
app.use(cors());
app.use(bodyParser.json());

/**
 * -----------------------
 * Listen for new warnings
 * -----------------------
 */
const warningsRef = admin.database().ref('WARNINGS/LOCATION');

warningsRef.on('child_added', async (snapshot) => {
  const warning = snapshot.val();
  const warningId = snapshot.key;

  try {
    // Skip if already notified (safety check)
    if (warning.notified) {
      console.log(`Warning ${warningId} already notified, skipping...`);
      return;
    }

    if (!warning.Token) {
      console.warn(`Warning ${warningId} has no device token, skipping...`);
      return;
    }

    // Create notification message
    const message = {
      notification: {
        title: warning.Warning.replace(/_/g, ' '),
        body: `Location: ${warning.AreaName}`,
      },
      token: warning.Token, // single device token
    };

    // Send push notification
    const response = await admin.messaging().send(message);
    console.log(`Notification sent for warning ${warningId}:`, response);

    // Mark as notified in DB
    await warningsRef.child(warningId).update({ notified: true });
  } catch (err) {
    console.error(`Error sending notification for warning ${warningId}:`, err);
  }
});

/**
 * -----------------------
 * Start server
 * -----------------------
 */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
