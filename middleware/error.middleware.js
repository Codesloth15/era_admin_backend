import { HttpError } from '../utils/http-error.js';

// Only our own errors (fail() / HttpError) and Express's request errors (bad JSON, body too
// large: expose is true) may show their message and status. Upstream errors that happen to carry
// a status, such as Google API errors, are logged and answered with a generic 500.
const isClientSafe = error => error instanceof HttpError || (error.expose === true && Number.isInteger(error.status));

function errorHandler(error, req, res, next) {
  const code = typeof error.code === 'string' && /^[a-zA-Z0-9_/-]{1,100}$/.test(error.code) ? error.code : undefined;
  const safe = isClientSafe(error);
  if (!safe) console.error('Agency API failure:', { method: req.method, path: req.path, code: code || error.name, message: error.message });
  const guidance = {
    'auth/insufficient-permission': 'The backend service account lacks permission to create Firebase Authentication users. Ask your Firebase project administrator to grant the required Authentication permissions.',
    'auth/operation-not-allowed': 'Firebase Authentication rejected this operation. Check the project Authentication configuration in the Firebase console.',
    'auth/project-not-found': 'The backend Firebase project configuration is invalid.',
    'auth/internal-error': 'Firebase Authentication could not complete the request. Check the backend terminal for the upstream error.',
  };
  const message = safe ? error.message : guidance[code] || 'Operation failed. Check the backend terminal for details and try again.';
  res.status(safe ? error.status : 500).json({ error: code ? message + ' (' + code + ')' : message, ...(code ? { code } : {}) });
}

export { errorHandler };
