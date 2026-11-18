import { Router } from 'express';
import { createAgencyController } from '../controller/agency.controller.js';
import { createInvitationController } from '../controller/invitation.controller.js';
import { createResponseReportRouter } from './response-report.routes.js';
import { createIncidentRouter } from './incident.routes.js';
import { createAdvisoryRouter } from './advisory.routes.js';
import { createOwnerRouter } from './owner.routes.js';
import { createInvitationRouter } from './invitation.routes.js';

// Mounted at /api/agencies. Order matters: fixed paths and sub-routers come before
// the /:code/... routes, and /:code/:collection must stay last.
export function createAgencyRouter(service) {
  const router = Router();
  const controller = createAgencyController(service);
  const invitations = createInvitationController(service);
  router.use('/response-reports', createResponseReportRouter(service));
  router.use('/incidents', createIncidentRouter(service));
  router.use('/advisories', createAdvisoryRouter(service));
  router.get('/', controller.list);
  router.get('/stations', controller.stationDirectory);
  router.get('/directory', controller.agencyDirectory);
  router.post('/account-role', controller.consolidateAccountRole);
  router.use('/owner', createOwnerRouter(service));
  router.post('/:code/admins', controller.createAgencyAdmin);
  router.get('/dispatch-data', controller.agencyDispatchData);
  router.post('/dispatch-command', controller.agencyDispatchCommand);
  router.get('/location', controller.accountStation);
  router.get('/dashboard', controller.dashboard);
  router.post('/', controller.createAgency);
  router.post('/:code/responders', controller.createResponder);
  router.post('/:code/responders/:uid/profile', controller.updateResponderProfile);
  router.post('/:code/station-assignment', controller.assignStation);
  router.post('/:code/invitations', invitations.invite);
  router.use('/invitations', createInvitationRouter(service));
  router.post('/:code/status', controller.status);
  // Before the /:code/:collection catch-all.
  router.post('/:code/hotline', controller.updateAgencyHotline);
  router.post('/:code/:collection', controller.saveResource);
  return router;
}
