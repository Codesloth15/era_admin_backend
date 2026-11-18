import { Router } from 'express';
import { createAdvisoryController } from '../controller/advisory.controller.js';

// Mounted at /api/agencies/advisories
export function createAdvisoryRouter(service) {
  const router = Router();
  const controller = createAdvisoryController(service);
  router.get('/', controller.listAdvisories);
  router.post('/', controller.saveAdvisory);
  router.post('/:id/publish', controller.publishAdvisory);
  router.post('/:id/archive', controller.archiveAdvisory);
  router.post('/:id/unarchive', controller.unarchiveAdvisory);
  router.post('/:id/delete', controller.deleteAdvisory);
  router.post('/:id/image', controller.uploadAdvisoryImage);
  router.post('/:id/image/delete', controller.removeAdvisoryImage);
  return router;
}
