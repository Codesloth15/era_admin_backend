import { respond } from '../utils/respond.js';

export function createInvitationController(service) {
  return {
    invite: respond(req => service.invite(req.uid, req.params.code, req.body)),
    provision: respond(req => service.provision(req.uid, req.params.id, req.body)),
    invitationAction: respond(req => service.invitationAction(req.uid, req.params.id, req.params.action)),
  };
}
