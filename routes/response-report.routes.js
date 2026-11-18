import { Router } from 'express';
import { createResponseReportController } from '../controller/response-report.controller.js';

// Mounted at /api/agencies/response-reports
export function createResponseReportRouter(service) {
  const router = Router();
  const controller = createResponseReportController(service);
  router.get('/', controller.responseReportData);
  router.post('/', controller.submitResponseReport);
  router.post('/:id/review', controller.reviewResponseReport);
  return router;
}
