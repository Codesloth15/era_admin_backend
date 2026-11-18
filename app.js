import express from 'express';
import cors from 'cors';

import { createAgencyRouter } from './routes/agency.routes.js';
import { createUserRouter } from './routes/user.routes.js';

import { authenticate } from './middleware/auth.middleware.js';
import { errorHandler } from './middleware/error.middleware.js';

// Builds the Express app from injected services, so tests can supply in-memory fakes.
// userService is optional: the legacy /api/users routes are mounted only when it is given.
export function createApp({ service, auth, userService }) {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors());
  // Advisory cover images (up to 3 MB, sent as base64) are the only large request bodies.
  app.use('/api/agencies/advisories/:id/image', express.json({ limit: '4.5mb' }));
  app.use(express.json({ limit: '20kb' }));

  // Deploy behind a same-origin reverse proxy.
  app.use('/api/agencies', authenticate(auth), createAgencyRouter(service));
  if (userService) app.use('/api/users', createUserRouter(userService));

  app.use(errorHandler);

  return app;
}
