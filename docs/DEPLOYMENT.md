# Deploying the backend on Render

Scope: `era_admin_backend`, the Agency API. The web admin, owner app and citizen app are deployed separately.

## 1. Before you deploy

- **Rotate the Firebase service account key first.** The keys were in the git history (BUGS.md B1). Create a new key in the Firebase console and delete the old one.
- **Never commit a key file or `.env`.** `.gitignore` already excludes `.env`, `firebase/*.json` and `*service-account*.json`.
- **Check the Node version.** `package.json` requires Node 22.9 or later. Set Node 22 on Render.
- **Set CORS** before go-live: `CORS_ALLOWED_ORIGINS` (section 3) must list the web admin and owner app addresses. Only those addresses can call the API from a browser. If it's empty, browsers on other sites are refused, and the server logs a warning at startup.

## 2. Create the Render service

| Setting | Value |
|---|---|
| Service type | Web Service |
| Repository | the ERA repository |
| Root directory | `era_admin_backend` |
| Runtime | Node |
| Build command | `npm ci` |
| Start command | `npm start` (runs `node server.js`) |
| Health check path | none yet. The API has no public health route, so use the TCP check. Add `GET /health` later if needed |
| Instance | Start with the smallest paid plan. The free plan sleeps and delays the first request |

## 3. Environment variables

Set these in Render under **Environment**. The names match `config/env.js` and `.env.example`.

| Name | Required | Value | Notes |
|---|---|---|---|
| `FIREBASE_PROJECT_ID` | Yes | `era-tabuk-city` | From the Firebase console, Project settings |
| `FIREBASE_DATABASE_URL` | Yes | `https://era-tabuk-city-default-rtdb.asia-southeast1.firebasedatabase.app` | The server stops at startup if this is missing |
| `FIREBASE_STORAGE_BUCKET` | Yes, for advisory images | `era-tabuk-city.firebasestorage.app` | Used to upload cover images |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Yes, if not using the option below | `/etc/secrets/firebase-service-account.json` | Path of the Secret File (section 4) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Alternative to the path above | `/etc/secrets/firebase-service-account.json` | Application Default Credentials. Use one of the two, not both |
| `CORS_ALLOWED_ORIGINS` | Yes, for production | `https://<web-admin-domain>,https://<owner-app-domain>` | Comma-separated list of the only web addresses allowed to call the API from a browser. Empty refuses all other sites |
| `PORT` | No | leave unset | Render sets `PORT` itself. The server reads it. Its default is 5000 for local runs |
| `NODE_ENV` | Recommended | `production` | |

Old names `REACT_APP_FIREBASE_DATABASE_URL` and `REACT_APP_FIREBASE_STORAGE_BUCKET` still work, but use the `FIREBASE_*` names for new deployments.

Copy-paste block for the Render Environment page (no secrets in it):

```
FIREBASE_PROJECT_ID=era-tabuk-city
FIREBASE_DATABASE_URL=https://era-tabuk-city-default-rtdb.asia-southeast1.firebasedatabase.app
FIREBASE_STORAGE_BUCKET=era-tabuk-city.firebasestorage.app
FIREBASE_SERVICE_ACCOUNT_PATH=/etc/secrets/firebase-service-account.json
NODE_ENV=production
```

Do not set `PORT`, `AGENCY_API_TARGET` or `OWNER_API_TARGET`. Those belong to the web apps' development proxy only.

## 4. The service account key

1. In the Firebase console, go to **Project settings → Service accounts → Generate new private key**.
2. In Render, open the service, go to **Secret Files**, and add the file as `firebase-service-account.json`. Render mounts it at `/etc/secrets/firebase-service-account.json`.
3. Set `FIREBASE_SERVICE_ACCOUNT_PATH` to that path.
4. Keep the downloaded copy off the repository, and delete it from your computer once it's uploaded.

## 5. Connect the web apps

Backend address on Render: `https://era-admin-backend.onrender.com`.

The web admin (`era_web_admin/vercel.json`) and the owner app (`sentra_corp/vercel.json`) forward `/api/agencies/...` on Vercel to that address. The browser only sees the Vercel site, so CORS isn't involved for those calls. Keep `CORS_ALLOWED_ORIGINS` set to the web addresses anyway.

The web admin and owner app call the API at `/api/agencies`, on the same site. In development, a proxy forwards those calls to `127.0.0.1:5000`. That proxy doesn't exist in production, so choose one of these before users sign in:

- **Option A (simplest):** serve the web admin from the same domain as the API, with a reverse proxy that sends `/api/agencies` to Render.
- **Option B:** point each app at the Render URL. This needs a code change in the apps' API base path and CORS restricted to those origins.

Confirm which option you want before the first deployment.

## 6. First deploy and checks

1. Deploy from the Render dashboard, and check the logs for `Server running on port <PORT>`.
2. If the log says `FIREBASE_DATABASE_URL is required`, the variable is missing or blank.
3. If it says `Could not read the service account key file`, check `FIREBASE_SERVICE_ACCOUNT_PATH` and the Secret File name.
4. Sign in to the web admin and load the agency list. A "Agency service unavailable" message means the web app can't reach the API.
5. Run the backend tests locally before deploying: `npm test` in `era_admin_backend`.

## 7. Database rules

Rules are not deployed by Render. `database.rules.json` is deployed separately with the Firebase CLI. Check that the rules are current before go-live. BUGS.md B7 notes the file in the repo is not the full rule set.

## 8. Open items before go-live

| Item | Where |
|---|---|
| Rotate the service account key that was in git history | BUGS.md B1 (Critical) |
| Remove the old database export with personal data from the web repo | BUGS.md B21 (Critical) |
| Restrict CORS to known origins | Section 1 |
| Decide how the web apps reach the API | Section 5 |
