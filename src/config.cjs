// Every setting the backend reads from the environment, in one place.
// Names, examples and what each one does: era_admin_backend/.env.example.
const path = require('node:path');
const dotenv = require('dotenv');

const BACKEND_ROOT = path.resolve(__dirname, '..');

// Loads era_admin_backend/.env whichever folder the server is started from.
// Values already set in the host environment win over the file.
function loadEnvFile() {
  dotenv.config({ path: path.join(BACKEND_ROOT, '.env') });
}

// First value that is set and not blank, trimmed; undefined when there is none.
const pick = (...values) => values.map(value => (typeof value === 'string' ? value.trim() : '')).find(Boolean);

function readConfig(environment = process.env) {
  const serviceAccountPath = pick(environment.FIREBASE_SERVICE_ACCOUNT_PATH);
  return {
    port: pick(environment.PORT) || 5000,
    firebase: {
      projectId: pick(environment.FIREBASE_PROJECT_ID),
      // The REACT_APP_* names are the old ones. They are still read so older .env files keep working.
      databaseURL: pick(environment.FIREBASE_DATABASE_URL, environment.REACT_APP_FIREBASE_DATABASE_URL),
      storageBucket: pick(environment.FIREBASE_STORAGE_BUCKET, environment.REACT_APP_FIREBASE_STORAGE_BUCKET),
      // Service account key file. Relative paths start from era_admin_backend/.
      // When it is not set, Application Default Credentials are used (GOOGLE_APPLICATION_CREDENTIALS,
      // or the service account attached to the host on Google Cloud).
      serviceAccountPath: serviceAccountPath && path.resolve(BACKEND_ROOT, serviceAccountPath),
    },
  };
}

module.exports = { loadEnvFile, readConfig };
