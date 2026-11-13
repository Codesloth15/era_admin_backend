const { Router } = require('express');
const { createAgencyController } = require('../controllers/agencyController.cjs');

function createAgencyRouter(service) {
  const router = Router();
  const controller = createAgencyController(service);
  router.get('/response-reports', controller.responseReportData);
  router.post('/response-reports', controller.submitResponseReport);
  router.post('/response-reports/:id/review', controller.reviewResponseReport);
  router.post('/incidents', controller.createStaffIncident);
  router.get('/advisories', controller.listAdvisories);
  router.post('/advisories', controller.saveAdvisory);
  router.post('/advisories/:id/publish', controller.publishAdvisory);
  router.post('/advisories/:id/archive', controller.archiveAdvisory);
  router.post('/advisories/:id/unarchive', controller.unarchiveAdvisory);
  router.post('/advisories/:id/delete', controller.deleteAdvisory);
  router.post('/advisories/:id/image', controller.uploadAdvisoryImage);
  router.post('/advisories/:id/image/delete', controller.removeAdvisoryImage);
  router.get('/', controller.list);
  router.get('/stations', controller.stationDirectory);
  router.post('/account-role', controller.consolidateAccountRole);
  router.get('/owner/session', controller.ownerSession);
  router.get('/owner', controller.ownerList);
  router.post('/:code/admins', controller.createAgencyAdmin);
  router.get('/dispatch-data', controller.agencyDispatchData);
  router.post('/dispatch-command', controller.agencyDispatchCommand);
  router.get('/location', controller.accountStation);
  router.get('/dashboard', controller.dashboard);
  router.post('/', controller.createAgency);
  router.post('/:code/responders', controller.createResponder);
  router.post('/:code/responders/:uid/profile', controller.updateResponderProfile);
  router.post('/:code/station-assignment', controller.assignStation);
  router.post('/:code/invitations', controller.invite);
  router.post('/invitations/:id/provision', controller.provision);
  router.post('/invitations/:id/:action', controller.invitationAction);
  router.post('/:code/status', controller.status);
  router.post('/:code/:collection', controller.saveResource);
  return router;
}

module.exports = { createAgencyRouter };
