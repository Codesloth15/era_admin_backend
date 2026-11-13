function authenticate(auth) {
  return async (req, res, next) => {
    try {
      const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
      if (!token) return res.status(401).json({ error: 'Sign in required.' });
      req.uid = (await auth.verifyIdToken(token, true)).uid;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired session.' });
    }
  };
}

module.exports = { authenticate };
