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
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
