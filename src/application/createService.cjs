const { createAgencyContext } = require('./createAgencyContext.cjs');
const { createAccountLocation } = require('./useCases/accountLocation.cjs');
const { createAgencyManagement } = require('./useCases/agencyManagement.cjs');
const { createInvitations } = require('./useCases/invitations.cjs');
const { createAgencyDashboard } = require('./useCases/agencyDashboard.cjs');
const { createResponseReports } = require('./useCases/responseReports.cjs');
const { createAdvisories } = require('./useCases/advisories.cjs');
const { createStaffIncidents } = require('./useCases/staffIncidents.cjs');

function createService(dependencies) {
  const context = createAgencyContext(dependencies);
  return {
    profile: context.profile,
    ...createAccountLocation(context),
    ...createAgencyManagement(context),
    ...createInvitations(context),
    ...createAgencyDashboard(context),
    ...createResponseReports(context),
    ...createAdvisories(context),
    ...createStaffIncidents(context),
  };
}

module.exports = { createService };
