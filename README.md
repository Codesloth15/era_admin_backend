# ERA Command Center and Agency portals

The separate owner application is in `sentra_corp/` (see [setup instructions](../sentra_corp/README.md)). It uses this backend and the same Firebase project, with an owner frontend on port 4000. Restart the backend after installing owner API changes.

The command and agency portals share the existing React application, theme and Firebase Authentication project. They have separate login screens, navigation and protected workspaces; a second frontend deployment is not required.

- Command Center login: `/command-center/login`
- Agency login: `/agency/login`
- System Administrator agency management: `/command-center/agencies`
- Agency Administrator workspace: `/agency/dashboard`

## Run locally

Use Node.js 22.9 or later. Frontend dependencies are installed in `era_web_admin`. Backend dependencies have their own lockfile in `era_admin_backend`.

1. Copy `era_admin_backend/.env.example` to `era_admin_backend/.env` and fill in `FIREBASE_DATABASE_URL`, `FIREBASE_STORAGE_BUCKET` and `FIREBASE_SERVICE_ACCOUNT_PATH` (the path to a service account key file). Keep key files outside the repository. Every setting is read in one place, `config/env.js`, and `.env` is found even when the server is started from another folder. The frontend's Firebase API key is not an Admin credential.
2. From `era_admin_backend`, run `npm ci` then `npm start`.
3. From `era_web_admin`, run `npm start`. The development proxy forwards `/api/agencies` to `AGENCY_API_TARGET` (default `http://127.0.0.1:5000`).
4. Sign in with an existing active `SYSTEM_ADMIN` account. Legacy profiles remain supported at `users/{actualUid}`. Canonical city profiles, when present, take precedence over legacy profiles even when inactive.

In production, serve the built React app with SPA fallback, and reverse proxy `/api/agencies` to the Node service on the same origin. Bind the API to the private interface or internal service network. Supply credentials through the host environment or workload identity: leave `FIREBASE_SERVICE_ACCOUNT_PATH` empty and Application Default Credentials are used (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account attached to a Google Cloud host). The old `REACT_APP_FIREBASE_DATABASE_URL` and `REACT_APP_FIREBASE_STORAGE_BUCKET` names are still read when the new names are not set. Set PORT to change the default port 5000 and set `AGENCY_API_TARGET` in `era_web_admin/.env.local` to match. Never expose Admin credentials to the React build.

## Server architecture

The Node.js/Express server uses ES modules (`"type": "module"`) and the same flat layered layout as seasonal-harvest-backend:

```text
era_admin_backend/
  server.js                     # Startup only: settings, Firebase, compose services, listen
  app.js                        # Express app: middleware, routers, error middleware
  config/
    env.js                      # Every environment setting, read in one place
    data-paths.js               # Existing data hierarchy (CITY)
  database/
    firebase.js                 # Firebase Admin app and the adapters handed to services
  model/
    repository.model.js         # read(path) / transact(path, change) on the Realtime Database
    file-storage.model.js       # Firebase Storage uploads
  routes/                       # One router per resource (*.routes.js)
    agency.routes.js            # /api/agencies; mounts the routers below
    advisory.routes.js          # /api/agencies/advisories
    response-report.routes.js   # /api/agencies/response-reports
    incident.routes.js          # /api/agencies/incidents
    owner.routes.js             # /api/agencies/owner
    invitation.routes.js        # /api/agencies/invitations
  controller/                   # One controller per resource (*.controller.js)
  middleware/
    auth.middleware.js          # Firebase ID token check, sets req.uid
    error.middleware.js         # The one place errors become HTTP responses
  services/
    agency.service.js           # Composes the agency services
    agency-context.service.js   # Authorization and audited mutations
    *.service.js                # Advisories, invitations, reports, dashboard, incidents
    rules/                      # Validation and business rules (no Express or Firebase)
  utils/
    http-error.js               # HttpError and fail(message, status)
    respond.js                  # Sends a handler's result as JSON, passes errors on
  tests/                        # Vitest service and HTTP tests
```

Rules in `services/rules` do not import Express or Firebase. Services depend on injected repository, identity lookup, file storage, ID generation and clock capabilities. `model/` and `database/` implement persistence; routes, controllers and middleware handle HTTP. `server.js` wires the concrete dependencies together. No Firebase initialization occurs when importing services or creating the Express app. The old `/api/users` routes and the warning push listener were removed on 2026-11-16 (no app called them).

Errors: services throw with `fail(message, status)` from `utils/http-error.js`. `middleware/error.middleware.js` returns `{ error, code? }` with that status. Express request errors (bad JSON, body too large) keep their 4xx status. Any other error, including upstream errors that carry a status, is logged and returns a generic 500 message. A request without a JSON body is treated as an empty object, so it gets the usual 400 validation messages.

The repository contract is `read(path)` and `transact(path, change)`. Transaction callbacks must be synchronous and safe to retry; all related authorization, membership, invitation, and audit changes remain in one transaction. The identity adapter uses `getUser(uid)`, `getUserByEmail(email)`, `createUser(details)`, and `deleteUser(uid)`; HTTP authentication separately uses `verifyIdToken(token, checkRevoked)`. Tests supply in-memory implementations without importing Firebase.

Keep new business rules in `services/rules`, orchestration in `services`, SDK access in `model`/`database`, and HTTP concerns in routes, controllers and middleware. A new resource gets its own `*.routes.js` and `*.controller.js`, mounted in `agency.routes.js` before the `/:code/...` routes. Existing endpoint paths, data paths, and response shapes are preserved.

Run the server's automated tests from the workspace root with `npm test --prefix era_admin_backend`. Manual and live Firebase testing require user approval.

## Account onboarding

Create an agency and open Manage. Agency codes are normalized to uppercase. Privileged accounts use invitations: new invitations expire after seven days and do not create user profiles or grant login access. No invitation email service is configured and the UI explicitly states that no email was sent.

For responders, the agency administrator selects **Register responder**, enters the name, email, initial password, optional agency station, and account status. `POST /api/agencies/:code/responders` immediately creates the Firebase Authentication email/password account with its real UID, then atomically saves `users/{uid}`, `agency/{agencyId}/members/{uid}`, `agency/{agencyId}/responders/{uid}`, and an audit record beneath `server/City of Tabuk`. A BFP administrator can register only BFP responders; the same restriction applies to every agency. The role is fixed to RESPONDER and client-supplied ownership fields cannot change it. System administrators can also select the responder role in an agency's account form.

Responder registration does not require invitation approval and does not claim the email is verified. Passwords go only to Firebase Authentication and are never stored in profile, membership, responder, or audit records, or returned by the API. The administrator shares the initial credentials securely; registration sends no email. The profile's active flag controls application access, consistent with existing account status management. Firebase Auth itself remains enabled so subsequent activation works through the existing agency status operation.

Firebase Authentication and Realtime Database cannot commit atomically together. If the database save fails without a committed profile, the use case removes only the newly created Auth account. If commit status cannot be determined or cleanup fails, the API returns an explicit recovery message for the System Administrator. Existing Auth emails and pending invitations are rejected rather than reused or reassigned.

Create or locate the intended account in the real Firebase Authentication project, complete Firebase email verification, then use **Link Auth UID**. The server verifies the actual account, email, enabled state and uniqueness. A separate **Approve** action creates the canonical UID profile and agency membership atomically with an audit record. Existing legacy or canonical accounts cannot be overwritten. Activation can be withheld at approval. Revocation disables the account profile and agency membership; it does not delete the Auth account or historical records.

The first System Administrator must already be provisioned through a trusted operator process. The public UI cannot bootstrap its own privileged identity. AGENCY_ADMIN users can create RESPONDER accounts and change their own agency's responder account status; only SYSTEM_ADMIN can link or approve invitations, register agencies, and grant privileged roles. No agency administration role automatically gains dispatch authority.

## Agency workspace

Agency navigation includes the citywide feed, accounts and invitations, approved responder registrations, station and team forms, dispatch and response history references, and account settings. Station and team changes preserve operational fields. Settings supports appearance preferences and Firebase password-reset requests. The new feature adds no dispatch commands.

The API filters simulated incidents and exposes a summary without citizen contact information. It reads the canonical feed and original incident records. If the city feed has not been established, it makes a read-only projection of existing root incidents. It does not duplicate or migrate the originals. Existing operational web collections exclude records explicitly marked `isSimulation: true`; the simulation selectors and overview counters have been removed. Historical simulation records remain in Firebase.

## Hotlines

Each agency profile and each station can store one `hotline`, the public emergency number: a short code (911, 160), a landline such as (074) 627-1234, a mobile number such as 0917 123 4567, or a toll-free number. Text that isn't a phone number is rejected. The agency hotline is separate from the office `contactNumber`.

- `POST /api/agencies/:code/hotline` with `{ hotline }` sets or, when empty, removes an agency's hotline. Allowed for that agency's own administrator and for System Administrators; recorded in the audit log as `AGENCY_HOTLINE_UPDATED`.
- Station hotlines are part of the station form (`POST /api/agencies/:code/stations`). A station edit that sends no `hotline` keeps the saved one.
- `GET /api/agencies/directory` returns every agency's public details (`name`, `type`, `active`, `hotline`) to any signed-in administrator. It never includes members, emails or invitations.

## Database rules and deployment

`era_admin_backend/database.rules.json` is a conservative policy for the NEW API-managed hierarchy plus private profile reads. Direct client writes and collection reads are denied. Agency data, invitations and incident summaries are returned through the token-verified backend, which enforces role, active state and agency ownership on each operation. Profiles are readable only at the signed-in user's UID. The backend uses transactions for agency membership, invitations, user authorization and audit records.

The file is not a replacement policy for the pre-existing citizen and dispatch applications. Those applications use other root paths and currently perform client-side command transactions. Before deploying rules, merge the `server/City of Tabuk` subtree and UID profile policies into the actual exported deployment rules, preserving explicitly authorized legacy paths. Ancestor `.read` or `.write` grants bypass more restrictive child rules: remove any broad ancestor grants. Do not grant agency admins root-level or parent `users` access. No live rules or data were changed by this implementation.

Legacy CDRRMC data is never silently renamed or copied. Registration rejects CDRRMC, and rejects creating CDRRMO if the canonical legacy CDRRMC branch exists. No CDRRMC references were found in existing runtime source during inspection. Any legacy database branch must be backed up, reviewed for conflicting CDRRMO data and migrated by a trusted operator, including agency references, before registration proceeds.

## Verification

- `npm run lint`
- `npm run build`
- `npm test -- --watchAll=false --runInBand`
- `npm test --prefix era_admin_backend`

Automated checks are development tooling and do not add testing screens or simulated data to the product. Service checks use an isolated in-memory repository and HTTP server. They do not contact or modify production Firebase. Live credential, email-verification and deployed-rule verification must be performed against the intended Firebase project after configuration.

## Assigned station location

The map location follows the signed-in account's approved `agencyId` and `stationId`. The preferred assignment for BFP Bulanao is `agencyId: "BFP"` and `stationId: "BFP_BULANAO"`. If stationId is absent, the service resolves the account team station, the agency primaryStationId, or the sole station belonging to that agency. It does not guess among multiple stations. The authenticated `/api/agencies/location` endpoint resolves those fields from the actual UID; request parameters cannot select another account or station.

The service reads `server/City of Tabuk/agency/{agencyId}/stations/{stationId}` first, then the existing `stations/{stationId}` record with an agency ownership check. Nested `location.latitude` and `location.longitude` take precedence; top-level coordinates are supported. Missing, inactive, mismatched or invalid assigned stations produce an explicit error rather than choosing a different station. The reference refreshes every 15 seconds and clears when the signed-in account changes.

Stations marked simulated remain labelled fixed references and can originate explicitly labelled read-only route previews. Directions do not create or authorize a dispatch. No simulation flag is removed and station coordinates are never reported as device GPS. The monitor can resolve existing legacy station records through its already-authorized realtime station subscription, so those route previews work without the Agency API online. API-provided canonical station data takes precedence when available. Accounts with neither an agency nor a station assignment retain their existing personal saved-location behavior. The Fastest driving route panel displays the origin loading state and lookup errors directly. Restart the API after updating it to enable this endpoint.

## Profile map picker and staff/citizen sharing

Profile now includes **My shared location**. Open the map, click a point or drag the marker, enter a public label and choose **Save and share location**. Stop sharing deletes the shared pin. This saves a fixed manual reference and never starts device tracking or edits the account's station, agency or role.

The authoritative published pin is stored at `server/City of Tabuk/shared_locations/{actualAuthUid}`. Only the owning active staff account can create or change its pin. Owners can remove their pin. The published data contains only coordinates, the chosen label, a MANUAL source and a timestamp; it contains no email, phone, privileged role or other private profile fields.

Staff emergency maps subscribe in real time and show these pins. The current user's selected pin also takes priority as the origin for driving directions. `/shared-locations` provides a shared map for authenticated active staff and citizens; `/community/login` supports signing in to that read-only page with existing Firebase accounts. Citizens receive read access, not staff map-editing permissions.

Before using the save button in a deployed project, merge `shared-locations.rules.fragment.json` into the actual Firebase rules and publish those rules. The same subtree is included in the conservative `database.rules.json` example. Existing permissive ancestor rules must not bypass its owner checks. This implementation does not deploy live rules. The map picker and sharing use the existing Firebase client and do not require the Agency API.
