const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const fs = require('node:fs');
const { loadEnvFile, readConfig } = require('./src/config.cjs');

loadEnvFile();
const config = readConfig();

const { randomUUID } = require('node:crypto');
const { createFirebaseDependencies } = require('./src/infrastructure/firebase/createFirebaseDependencies.cjs');
const { createService } = require('./src/application/createService.cjs');
const { createApp } = require('./src/app.cjs');

function readServiceAccount(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read the service account key file ${file}. Check FIREBASE_SERVICE_ACCOUNT_PATH in era_admin_backend/.env. (${error.message})`);
  }
}

if (!admin.apps.length) {
  let credential;
  if (config.firebase.serviceAccountPath) {
    const serviceAccount = readServiceAccount(config.firebase.serviceAccountPath);
    credential = admin.credential.cert(serviceAccount);
    // Request uncompressed OAuth responses to avoid premature-close errors.
    const { JWT } = require('google-auth-library');
    const client = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/firebase.database',
        'https://www.googleapis.com/auth/firebase.messaging',
        'https://www.googleapis.com/auth/identitytoolkit',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
    });
    client.transporter.defaults = { headers: { 'Accept-Encoding': 'identity' } };
    credential.getAccessToken = async () => {
      await client.getAccessToken();
      return {
        access_token: client.credentials.access_token,
        expires_in: Math.max(1, Math.floor((client.credentials.expiry_date - Date.now()) / 1000)),
      };
    };
  } else {
    // GOOGLE_APPLICATION_CREDENTIALS, or the service account attached to the host on Google Cloud.
    credential = admin.credential.applicationDefault();
  }
  admin.initializeApp({
    credential,
    databaseURL: config.firebase.databaseURL,
    ...(config.firebase.projectId ? { projectId: config.firebase.projectId } : {}),
  });
}

const dependencies = createFirebaseDependencies(process.env, admin.app());
const service = createService({ ...dependencies, id: randomUUID });
const app = express();
app.use(cors());
createApp({ service, auth: dependencies.auth, app });

/**
 * -----------------------
 * Listen for new warnings
 * -----------------------
 */
const warningsRef = admin.database().ref("server/City of Tabuk/warning");
const respondersRef = admin.database().ref("server/City of Tabuk/command_center/responder/active_responder");

warningsRef.on("child_added", async (snapshot) => {
  const warning = snapshot.val();
  const warningId = snapshot.key;

  try {
    // Skip if already notified
    if (warning.notified) {
      console.log(`Warning ${warningId} already notified, skipping...`);
      return;
    }

    // Fetch all active responders
    const respondersSnapshot = await respondersRef.once("value");
    if (!respondersSnapshot.exists()) {
      console.warn("No active responders found, skipping notification");
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
      console.warn("No FCM tokens found, skipping notification");
      return;
    }

    // Send notifications individually (works in all firebase-admin versions)
    for (const token of tokens) {
      const message = {
        notification: {
          title: warning.Warning ? warning.Warning.replace(/_/g, " ") : "Emergency Alert",
          body: warning.AreaName ? `Location: ${warning.AreaName}` : "Check dashboard for details",
        },
        token: token,
      };

      try {
        await admin.messaging().send(message);
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

/**
 * -----------------------
 * User Management API
 * -----------------------
 */
const usersRef = admin.database().ref("cdrrmc/activeresponders");

// Add new user
app.post("/api/users", async (req, res) => {
  try {
    const userData = req.body;
    if (!userData.email) return res.status(400).json({ error: "Email is required" });

    const newUserRef = usersRef.push();
    await newUserRef.set(userData);

    res.json({ message: "User added successfully", id: newUserRef.key });
  } catch (err) {
    console.error("Error adding user:", err);
    res.status(500).json({ error: "Failed to add user" });
  }
});

// Get all users
app.get("/api/users", async (req, res) => {
  try {
    const snapshot = await usersRef.once("value");
    res.json({ users: snapshot.exists() ? snapshot.val() : [] });
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Get user by email
app.get("/api/users/email/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const snapshot = await usersRef.once("value");
    if (!snapshot.exists()) return res.status(404).json({ error: "No users found" });

    const users = snapshot.val();
    const userKey = Object.keys(users).find(key => users[key].email === email);
    if (!userKey) return res.status(404).json({ error: "User not found" });

    res.json({ id: userKey, ...users[userKey] });
  } catch (err) {
    console.error("Error fetching user by email:", err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// Update user by ID
app.put("/api/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    await usersRef.child(id).update(updates);
    res.json({ message: "User updated successfully" });
  } catch (err) {
    console.error("Error updating user:", err);
    res.status(500).json({ error: "Failed to update user" });
  }
});

/**
 * -----------------------
 * Start server
 * -----------------------
 */
const PORT = config.port;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
