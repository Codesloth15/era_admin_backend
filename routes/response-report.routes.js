import { Router } from 'express';
import { createResponseReportController } from '../controller/response-report.controller.js';

// Mounted at /api/agencies/response-reports
export function createResponseReportRouter(service) {
  const router = Router();
  const controller = createResponseReportController(service);
  router.get('/', controller.responseReportData);
  router.get('/summary', controller.responseSummary);
  router.post('/', controller.submitResponseReport);
  router.post('/:id/review', controller.reviewResponseReport);
  // Responders on the assigned team: POST /api/agencies/response-reports/assignments/:id/acknowledge
  router.post('/assignments/:id/acknowledge', controller.acknowledgeAssignment);
  // Then, in order: .../assignments/:id/en-route and .../assignments/:id/arrived
  router.post('/assignments/:id/en-route', controller.markAssignmentEnRoute);
  router.post('/assignments/:id/arrived', controller.markAssignmentArrived);
  return router;
}
