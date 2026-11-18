import { Router } from 'express';
import { createInvitationController } from '../controller/invitation.controller.js';

// Mounted at /api/agencies/invitations. Sending an invitation (POST /:code/invitations)
// is agency-scoped and lives in agency.routes.js.
export function createInvitationRouter(service) {
  const router = Router();
  const controller = createInvitationController(service);
  router.post('/:id/provision', controller.provision);
  router.post('/:id/:action', controller.invitationAction);
  return router;
}
