const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const cors = require('cors');
require('dotenv').config();

const serviceAccount = require('../backend/firebase/serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.REACT_APP_FIREBASE_DATABASE_URL,
});

const app = express();
app.use(cors());
app.use(bodyParser.json());

/**
 * -----------------------
 * Manual send notifications route
 * -----------------------
 */
app.post('/api/notification/send', async (req, res) => {
  const { title, body } = req.body;

  try {
    // Fetch responder tokens from Firebase
    const snapshot = await admin.database().ref('responder/TOKEN').once('value');
    const tokensData = snapshot.val();

    if (!tokensData) {
      return res.status(404).json({ message: 'No tokens found' });
    }

    // Normalize tokens (handle string, array, or object)
    let tokens;
    if (typeof tokensData === 'string') {
      tokens = [tokensData]; // single token
    } else if (Array.isArray(tokensData)) {
      tokens = tokensData;   // already array
    } else {
      tokens = Object.values(tokecdnsData); // object → array of tokens
    }

    // Create FCM message
    const message = {
      notification: { title, body },
      tokens,
    };

    // Send push notifications
    const response = await admin.messaging().sendEachForMulticast(message);

    // Track results
    const sentTokens = [];
    const failedTokens = [];

    response.responses.forEach((resp, idx) => {
      if (resp.success) {
        sentTokens.push(tokens[idx]);
      } else {
        failedTokens.push({
          token: tokens[idx],
          error: resp.error?.message || 'Unknown error',
        });
      }
    });

    console.log('Manual notification sent to tokens:', sentTokens);
    if (failedTokens.length > 0) {
      console.warn('Failed tokens:', failedTokens);
    }

    // Send response to client
    res.json({
      success: true,
      sent: response.successCount,
      failed: response.failureCount,
      sentTokens,
      failedTokens,
    });
  } catch (err) {
    console.error('Error sending notification:', err);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------
// Start server
// -----------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
