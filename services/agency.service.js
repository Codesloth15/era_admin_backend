import { createAgencyContext } from './agency-context.service.js';
import { createAccountLocation } from './account-location.service.js';
import { createAgencyManagement } from './agency-management.service.js';
import { createInvitations } from './invitation.service.js';
import { createAgencyDashboard } from './agency-dashboard.service.js';
import { createResponseReports } from './response-report.service.js';
import { createAdvisories } from './advisory.service.js';
import { createStaffIncidents } from './staff-incident.service.js';

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

export { createService };
