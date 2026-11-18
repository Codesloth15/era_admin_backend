import { respond } from '../utils/respond.js';

export function createAgencyController(service) {
  return {
    list: respond(req => service.list(req.uid)),
    stationDirectory: respond(req => service.stationDirectory(req.uid)),
    agencyDirectory: respond(req => service.agencyDirectory(req.uid)),
    consolidateAccountRole: respond(req => service.consolidateAccountRole(req.uid)),
    createAgency: respond(req => service.createAgency(req.uid, req.body)),
    createAgencyAdmin: respond(req => service.createAgencyAdmin(req.uid, req.params.code, req.body)),
    agencyDispatchData: respond(req => service.agencyDispatchData(req.uid, req.query.collection)),
    agencyDispatchCommand: respond(req => service.agencyDispatchCommand(req.uid, req.body)),
    accountStation: respond(req => service.accountStation(req.uid)),
    dashboard: respond(req => service.dashboard(req.uid)),
    createResponder: respond(req => service.createResponder(req.uid, req.params.code, req.body)),
    updateResponderProfile: respond(req => service.updateResponderProfile(req.uid, req.params.code, req.params.uid, req.body)),
    assignStation: respond(req => service.assignStation(req.uid, req.params.code, req.body)),
    status: respond(req => service.status(req.uid, req.params.code, req.body)),
    updateAgencyHotline: respond(req => service.updateAgencyHotline(req.uid, req.params.code, req.body)),
    saveResource: respond(req => service.saveResource(req.uid, req.params.code, req.params.collection, req.body)),
  };
}
