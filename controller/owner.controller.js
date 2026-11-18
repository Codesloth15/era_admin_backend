import { respond } from '../utils/respond.js';

export function createOwnerController(service) {
  return {
    ownerSession: respond(req => service.ownerSession(req.uid)),
    ownerList: respond(req => service.ownerList(req.uid)),
    createCommandAdmin: respond(req => service.createCommandAdmin(req.uid, req.body)),
    setAgencyEmergencies: respond(req => service.setAgencyEmergencies(req.uid, req.params.code, req.body)),
  };
}
