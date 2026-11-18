import { randomUUID } from 'node:crypto';

import { loadEnvFile, readConfig } from './config/env.js';
import { initializeFirebase, createFirebaseDependencies } from './database/firebase.js';
import { createService } from './services/agency.service.js';
import { createApp } from './app.js';

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

  app.listen(config.port, () => console.log(`Server running on port ${config.port}`));
};

try {
  startServer();
} catch (error) {
  console.error('Server startup failed.', error);
  process.exitCode = 1;
}
