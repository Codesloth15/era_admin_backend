const express = require('express');
const { authenticate } = require('./presentation/middleware/authenticate.cjs');
const { errorHandler } = require('./presentation/middleware/errorHandler.cjs');
const { createAgencyRouter } = require('./presentation/routes/agencyRoutes.cjs');

function createApp({ service, auth, app = express() }) {
  app.disable('x-powered-by');
  // Advisory cover images (up to 3 MB, sent as base64) are the only large request bodies.
  app.use('/api/agencies/advisories/:id/image', express.json({ limit: '4.5mb' }));
  app.use(express.json({ limit: '20kb' }));
  // Deploy behind a same-origin reverse proxy.
  app.use('/api/agencies', authenticate(auth), createAgencyRouter(service));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
