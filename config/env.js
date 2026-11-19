// Every setting the backend reads from the environment, in one place.
// Names, examples and what each one does: era_admin_backend/.env.example.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Loads the file for this mode first (.env.production on NODE_ENV=production, otherwise .env.development),
// then the shared .env. Values already set in the host environment win over both files.
export function loadEnvFile() {
  const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';
  dotenv.config({ path: path.join(BACKEND_ROOT, `.env.${mode}`) });
  dotenv.config({ path: path.join(BACKEND_ROOT, '.env') });
}

// First value that is set and not blank, trimmed; undefined when there is none.
const pick = (...values) => values.map(value => (typeof value === 'string' ? value.trim() : '')).find(Boolean);

export function readConfig(environment = process.env) {
  const serviceAccountPath = pick(environment.FIREBASE_SERVICE_ACCOUNT_PATH);
  return {
    port: pick(environment.PORT) || 5000,
    // Browser origins allowed to call the API, comma-separated. Empty means browsers on other sites are refused.
    corsOrigins: (environment.CORS_ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean),
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
