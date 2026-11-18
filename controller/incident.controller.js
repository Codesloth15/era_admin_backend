import { respond } from '../utils/respond.js';

export function createIncidentController(service) {
  return {
    createStaffIncident: respond(req => service.createStaffIncident(req.uid, req.body)),
    verifyIncident: respond(req => service.verifyIncident(req.uid, req.params.id)),
  };
}
