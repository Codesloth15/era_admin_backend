import { respond } from '../utils/respond.js';

export function createAdvisoryController(service) {
  return {
    listAdvisories: respond(req => service.listAdvisories(req.uid)),
    saveAdvisory: respond(req => service.saveAdvisory(req.uid, req.body)),
    publishAdvisory: respond(req => service.publishAdvisory(req.uid, req.params.id)),
    archiveAdvisory: respond(req => service.archiveAdvisory(req.uid, req.params.id)),
    unarchiveAdvisory: respond(req => service.unarchiveAdvisory(req.uid, req.params.id)),
    deleteAdvisory: respond(req => service.deleteAdvisory(req.uid, req.params.id)),
    uploadAdvisoryImage: respond(req => service.uploadAdvisoryImage(req.uid, req.params.id, req.body)),
    removeAdvisoryImage: respond(req => service.removeAdvisoryImage(req.uid, req.params.id)),
  };
}
