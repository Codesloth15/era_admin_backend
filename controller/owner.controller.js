import { respond } from '../utils/respond.js';

export function createOwnerController(service) {
  return {
    ownerSession: respond(req => service.ownerSession(req.uid)),
    ownerList: respond(req => service.ownerList(req.uid)),
  };
}
