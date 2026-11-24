import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

import { loadEnvFile, readConfig } from './config/env.js';
import { initializeFirebase, createFirebaseDependencies } from './database/firebase.js';
import { createService } from './services/agency.service.js';
import { createAlertNotifications } from './services/alert-notification.service.js';
import { MAX_ALERT_AGE_MS } from './services/rules/alert-notification.rules.js';
import { createApp } from './app.js';

// Pushes each new citizen alert inside Tabuk City to every active responder's phone.
const startAlertNotifications = ({ repository, push, incidentFeed }) => {
  const boundaries = JSON.parse(fs.readFileSync(new URL('./config/tabuk-barangays.json', import.meta.url), 'utf8'));
  const alerts = createAlertNotifications({ repository, push, boundaries, now: Date.now });
  incidentFeed.watchNew(Date.now() - MAX_ALERT_AGE_MS, async (incidentId, incident) => {
    try {
      const outcome = await alerts.notifyNewIncident(incidentId, incident);
      if (!['SKIPPED', 'ALREADY_HANDLED'].includes(outcome.status)) {
        console.log(`Alert push ${incidentId}: ${outcome.status}`, outcome.recipients === undefined ? '' : `${outcome.successCount ?? 0}/${outcome.recipients} phones`);
      }
    } catch (error) {
      console.error(`Alert push ${incidentId} failed.`, error);
    }
  }, error => console.error('Alert push listener stopped. Restart the server to resume push notifications.', error));
};

const startServer = () => {
  loadEnvFile();
  const config = readConfig();

  const firebaseApp = initializeFirebase(config);
  const dependencies = createFirebaseDependencies(process.env, firebaseApp);

  const app = createApp({
    service: createService({ ...dependencies, id: randomUUID }),
    auth: dependencies.auth,
    corsOrigins: config.corsOrigins,
  });
  if (!config.corsOrigins.length) console.warn('CORS_ALLOWED_ORIGINS is not set: browsers on other sites will be refused.');

  startAlertNotifications(dependencies);
  app.listen(config.port, () => console.log(`Server running on port ${config.port}`));
};

try {
  startServer();
} catch (error) {
  console.error('Server startup failed.', error);
  process.exitCode = 1;
}
