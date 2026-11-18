import { randomUUID } from 'node:crypto';
import { getDatabase } from 'firebase-admin/database';
import { getMessaging } from 'firebase-admin/messaging';

import { loadEnvFile, readConfig } from './config/env.js';
import { initializeFirebase, createFirebaseDependencies } from './database/firebase.js';
import { createService } from './services/agency.service.js';
import { createUserService } from './services/user.service.js';
import { startWarningNotifications } from './services/warning-notification.service.js';
import { createApp } from './app.js';

const startServer = () => {
  loadEnvFile();
  const config = readConfig();

  const firebaseApp = initializeFirebase(config);
  const db = getDatabase(firebaseApp);
  const dependencies = createFirebaseDependencies(process.env, firebaseApp);

  const app = createApp({
    service: createService({ ...dependencies, id: randomUUID }),
    auth: dependencies.auth,
    userService: createUserService(db),
  });

  startWarningNotifications(db, getMessaging(firebaseApp));

  app.listen(config.port, () => console.log(`Server running on port ${config.port}`));
};

try {
  startServer();
} catch (error) {
  console.error('Server startup failed.', error);
  process.exitCode = 1;
}
