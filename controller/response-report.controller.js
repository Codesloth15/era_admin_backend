import { respond } from '../utils/respond.js';

export function createResponseReportController(service) {
  return {
    responseReportData: respond(req => service.responseReportData(req.uid)),
    responseSummary: respond(req => service.responseSummary(req.uid, { month: req.query.month, emergencyType: req.query.emergencyType })),
    submitResponseReport: respond(req => service.submitResponseReport(req.uid, req.body)),
    reviewResponseReport: respond(req => service.reviewResponseReport(req.uid, req.params.id, req.body)),
    acknowledgeAssignment: respond(req => service.acknowledgeAssignment(req.uid, req.params.id)),
  };
}
