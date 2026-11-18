import { Router } from 'express';
import { createOwnerController } from '../controller/owner.controller.js';

// Mounted at /api/agencies/owner
export function createOwnerRouter(service) {
  const router = Router();
  const controller = createOwnerController(service);
  router.get('/session', controller.ownerSession);
  router.get('/', controller.ownerList);
  router.post('/command-admins', controller.createCommandAdmin);
  router.post('/agencies/:code/emergencies', controller.setAgencyEmergencies);
  return router;
}
