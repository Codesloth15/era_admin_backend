function errorHandler(error, req, res, next) {
  const code = typeof error.code === 'string' && /^[a-zA-Z0-9_/-]{1,100}$/.test(error.code) ? error.code : undefined;
  if (!error.status) console.error('Agency API failure:', { method: req.method, path: req.path, code: code || error.name, message: error.message });
  const guidance = {
    'auth/insufficient-permission': 'The backend service account lacks permission to create Firebase Authentication users. Ask your Firebase project administrator to grant the required Authentication permissions.',
    'auth/operation-not-allowed': 'Firebase Authentication rejected this operation. Check the project Authentication configuration in the Firebase console.',
    'auth/project-not-found': 'The backend Firebase project configuration is invalid.',
    'auth/internal-error': 'Firebase Authentication could not complete the request. Check the backend terminal for the upstream error.',
  };
  const message = error.status ? error.message : guidance[code] || 'Operation failed. Check the backend terminal for details and try again.';
  res.status(error.status || 500).json({ error: code ? message + ' (' + code + ')' : message, ...(code ? { code } : {}) });
}

module.exports = { errorHandler };
