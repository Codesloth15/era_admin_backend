// backend/routes/notification.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// For demonstration we use an in-memory array. Replace with DB in production.
let tokens = [];

// register token endpoint (web & mobile should call this)
router.post('/register', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  if (!tokens.includes(token)) tokens.push(token);
  return res.json({ message: 'token registered', tokensCount: tokens.length });
});

// remove token (optional)
router.post('/unregister', (req, res) => {
  const { token } = req.body;
  tokens = tokens.filter(t => t !== token);
  return res.json({ message: 'token removed', tokensCount: tokens.length });
});

// send notification to all tokens
router.post('/', async (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body required' });
  if (tokens.length === 0) return res.status(400).json({ error: 'no tokens registered' });

  const message = {
    notification: { title, body },
    tokens: tokens,
  };

  try {
    const response = await admin.messaging().sendMulticast(message);
    return res.json({ success: true, response });
  } catch (err) {
    console.error('FCM send error', err);
    return res.status(500).json({ error: 'failed to send', details: err.message });
  }
});

module.exports = router;
