function createAgencyController(service) {
  const respond = handler => async (req, res, next) => {
    try {
      res.json(await handler(req));
    } catch (error) {
      next(error);
    }
  };
  return {
    responseReportData: respond(req => service.responseReportData(req.uid)),
    submitResponseReport: respond(req => service.submitResponseReport(req.uid, req.body)),
    reviewResponseReport: respond(req => service.reviewResponseReport(req.uid, req.params.id, req.body)),
    createStaffIncident: respond(req => service.createStaffIncident(req.uid, req.body)),
    listAdvisories: respond(req => service.listAdvisories(req.uid)),
    saveAdvisory: respond(req => service.saveAdvisory(req.uid, req.body)),
    publishAdvisory: respond(req => service.publishAdvisory(req.uid, req.params.id)),
    archiveAdvisory: respond(req => service.archiveAdvisory(req.uid, req.params.id)),
    unarchiveAdvisory: respond(req => service.unarchiveAdvisory(req.uid, req.params.id)),
    deleteAdvisory: respond(req => service.deleteAdvisory(req.uid, req.params.id)),
    uploadAdvisoryImage: respond(req => service.uploadAdvisoryImage(req.uid, req.params.id, req.body)),
    removeAdvisoryImage: respond(req => service.removeAdvisoryImage(req.uid, req.params.id)),
    list: respond(req => service.list(req.uid)),
    stationDirectory: respond(req => service.stationDirectory(req.uid)),
    consolidateAccountRole: respond(req => service.consolidateAccountRole(req.uid)),
    ownerSession: respond(req => service.ownerSession(req.uid)),
    ownerList: respond(req => service.ownerList(req.uid)),
    createAgencyAdmin: respond(req => service.createAgencyAdmin(req.uid, req.params.code, req.body)),
    agencyDispatchData: respond(req => service.agencyDispatchData(req.uid, req.query.collection)),
    agencyDispatchCommand: respond(req => service.agencyDispatchCommand(req.uid, req.body)),
    accountStation: respond(req => service.accountStation(req.uid)),
    dashboard: respond(req => service.dashboard(req.uid)),
    createAgency: respond(req => service.createAgency(req.uid, req.body)),
    createResponder: respond(req => service.createResponder(req.uid, req.params.code, req.body)),
    updateResponderProfile: respond(req => service.updateResponderProfile(req.uid, req.params.code, req.params.uid, req.body)),
    assignStation: respond(req => service.assignStation(req.uid, req.params.code, req.body)),
    invite: respond(req => service.invite(req.uid, req.params.code, req.body)),
    provision: respond(req => service.provision(req.uid, req.params.id, req.body)),
    invitationAction: respond(req => service.invitationAction(req.uid, req.params.id, req.params.action)),
    status: respond(req => service.status(req.uid, req.params.code, req.body)),
    saveResource: respond(req => service.saveResource(req.uid, req.params.code, req.params.collection, req.body)),
  };
}

module.exports = { createAgencyController };
