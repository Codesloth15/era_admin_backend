import { Router } from 'express';
import { createIncidentController } from '../controller/incident.controller.js';

// Mounted at /api/agencies/incidents
export function createIncidentRouter(service) {
  const router = Router();
  const controller = createIncidentController(service);
  router.post('/', controller.createStaffIncident);
  router.post('/:id/verify', controller.verifyIncident);
  return router;
}
