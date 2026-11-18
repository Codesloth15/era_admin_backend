# Backend System Architecture (Reusable Template)

> A reusable architecture for Node.js + Express + Supabase REST APIs, with an optional
> AI assistant built on Claude (Anthropic).
> It follows the layered design of `era_admin_backend`: domain, application,
> infrastructure and presentation, wired together in `server.js`.
> Examples use ERA names (agencies, advisories, `SYSTEM_ADMIN`). Replace them with your own.
> Sections marked **(optional)** can be removed if your project doesn't need them.
>
> **Not used yet:** Arcjet. Rate limiting is a small in-memory middleware for now (section 9.6).

---

## 1. Overview

`<project-name>` is a Node.js REST API on Express, written as CommonJS modules (`.cjs`).
Business rules don't import Express or any SDK. Use cases receive their dependencies
(repositories, auth, file storage, AI, ID and clock) as arguments, so tests run with
in-memory fakes and no credentials.

Supabase provides:

- **Auth**: sign-in (done by the frontend), token checks and admin user management (done by the backend)
- **PostgreSQL**: application data, row-level security (RLS) and SQL functions for atomic writes
- **Storage**: uploaded files, such as advisory cover images
- **Realtime**: live updates that the frontend reads directly, filtered by RLS
- **Migrations**: versioned SQL files managed with the Supabase CLI

Anthropic provides the Claude model for the optional AI assistant.

### What stays the same as `era_admin_backend`, and what changes

| Area | Stays the same | Changes |
|---|---|---|
| Layers | `domain/`, `application/`, `infrastructure/`, `presentation/` | Nothing |
| Wiring | `server.js` builds the adapters and passes them in | Supabase and Anthropic adapters replace the Firebase one |
| Settings | Every setting is read once, in `src/config.cjs`, from one `.env` | New names: `SUPABASE_*`, `ANTHROPIC_*` |
| Auth check | `Authorization: Bearer <token>` sets `req.uid` | Token is checked with Supabase Auth, not `verifyIdToken` |
| Permissions | `actor(uid)` and `permit(...)` in the application layer | SQL functions check permissions again inside the transaction |
| Data access | Use cases call an injected repository | The repository is per resource (tables and SQL functions), not `read(path)` / `transact(path)` |
| Atomic writes | A change and its audit record are saved together | One SQL function call instead of a tree transaction |
| Responses | Plain JSON objects; errors as `{ error, code? }` | Nothing |
| Tests | `node:test` with in-memory fakes | Fakes now match the Supabase repository methods |

---

## 2. Tech stack and tools

### Runtime dependencies

| Tool | Package | Purpose | Where it lives |
|---|---|---|---|
| Node.js (22.9+) | — | JavaScript runtime | whole project |
| Express 5 | `express` | HTTP server, routing, middleware | `src/app.cjs`, `src/presentation/` |
| Supabase JS | `@supabase/supabase-js` | Auth admin, queries, SQL function calls (`rpc`), Storage | `src/infrastructure/supabase/` only |
| dotenv | `dotenv` | Loads `.env` from the backend folder | `src/config.cjs` |
| Anthropic SDK **(optional)** | `@anthropic-ai/sdk` | Claude Messages API with tool use | `src/infrastructure/anthropic/` only |
| CORS **(optional)** | `cors` | Only needed if the API isn't served from the same origin as the frontend | `src/app.cjs` |

### Development tools

| Tool | Package | Purpose |
|---|---|---|
| Node test runner | built in (`node:test`, `node:assert/strict`) | Unit and HTTP tests |
| Watch mode | built in (`node --watch`) | Restarts the server on file changes |
| Supabase CLI | external | Local Supabase, migrations, SQL tests |
| ESLint **(optional)** | `eslint` | Linting |

### Built-in Node.js APIs

| API | Purpose |
|---|---|
| `node:crypto` (`randomUUID`) | IDs passed to use cases (`id()`), storage object names |
| `node:path` | Resolving `.env` and file paths from the backend folder |
| Global `fetch` | HTTP tests against `createApp().listen(0)` |

### External services

| Service | Role |
|---|---|
| Supabase Auth | Identity, access tokens, admin user creation |
| Supabase PostgreSQL | Data, RLS, triggers, SQL functions |
| Supabase Storage | File buckets |
| Supabase Realtime | Live table changes for the frontend |
| Anthropic API **(optional)** | Claude model for the assistant |
| Firebase Cloud Messaging **(optional)** | Push notifications to the mobile app (Supabase has no push service) |
| Hosting | Runs the Node process behind a same-origin reverse proxy; reads `PORT` |

---

## 3. High-level architecture

```text
              Web admin (React)                    Mobile / citizen app
          |                     \                         |
          | HTTPS + JSON         \ Supabase JS             | Supabase JS
          | Bearer access token   \ (publishable key)      | (publishable key)
          v                        \                       v
+---------------------------------+ \           +-----------------------------+
| server.js  (composition root)   |  `--------->| Supabase                    |
|  config -> adapters -> service  |             |  Auth   (sign-in)           |
|  -> createApp -> listen         |             |  Realtime (RLS-filtered)    |
|                                 |             |  Storage (public URLs)      |
|  presentation/                  |             +-----------------------------+
|    routes -> middleware ->      |                         ^
|    controllers (HTTP only)      |                         |
|          |                      |                         |
|          v                      |                         |
|  application/                   |    secret key (server)  |
|    createService, context,      |-------------------------'
|    useCases (orchestration)     |   via infrastructure/supabase
|          |                      |
|          v                      |
|  domain/                        |
|    *Rules.cjs (pure rules)      |
|                                 |
|  infrastructure/                |
|    supabase/   repositories,    |
|                auth, files      |
|    anthropic/  ai (optional)  --+------> Anthropic API (Claude)
+---------------------------------+
```

### Dependency rule

| Layer | May import | Must not import |
|---|---|---|
| `domain/` | Nothing outside `domain/` | Express, Supabase, Anthropic, `process.env` |
| `application/` | `domain/` | Express, any SDK, `process.env` |
| `infrastructure/` | SDKs, `domain/` (for `fail`), `config.cjs` | `presentation/` |
| `presentation/` | Express | SDKs, repositories |
| `server.js` | Everything | — |

No SDK client is created when a use case or `createApp` is imported. Only `server.js`
creates clients, so tests can import every layer without credentials.

---

## 4. Composition root (`server.js`)

```js
const { randomUUID } = require('node:crypto');
const { loadEnvFile, readConfig } = require('./src/config.cjs');
const { createSupabaseDependencies } = require('./src/infrastructure/supabase/createSupabaseDependencies.cjs');
const { createAnthropicDependencies } = require('./src/infrastructure/anthropic/createAnthropicDependencies.cjs');
const { createService } = require('./src/application/createService.cjs');
const { createApp } = require('./src/app.cjs');

loadEnvFile();
const config = readConfig();

const { repositories, auth, files } = createSupabaseDependencies(config);
const { ai } = createAnthropicDependencies(config); // { ai: null } when ANTHROPIC_API_KEY is empty
const service = createService({ repositories, auth, files, ai, id: randomUUID, now: Date.now });
const app = createApp({ service, auth, assistantLimit: config.assistantRateLimit });

app.listen(config.port, () => console.log(`API listening on port ${config.port}`));
```

`src/app.cjs` only assembles HTTP:

```js
function createApp({ service, auth, assistantLimit, app = express() }) {
  app.disable('x-powered-by');
  // Base64 images are the only large bodies. Register this before the global parser.
  app.use('/api/agencies/advisories/:id/image', express.json({ limit: '4.5mb' }));
  app.use(express.json({ limit: '20kb' }));
  app.use('/api/agencies', authenticate(auth), createAgencyRouter(service));
  app.use('/api/assistant', authenticate(auth), rateLimit(assistantLimit), createAssistantRouter(service)); // optional
  app.use(errorHandler);
  return app;
}
```

---

## 5. Request lifecycle

1. The **reverse proxy** forwards `/api/...` from the frontend's origin to the Node service.
2. **`express.json`** parses the body: a larger limit on image routes, `20kb` everywhere else.
3. **`authenticate(auth)`** reads `Authorization: Bearer <token>`, calls `auth.verifyToken`,
   and sets `req.uid`. Missing or invalid tokens get `401`.
4. **`rateLimit`** (assistant routes only) limits requests per `req.uid`.
5. The **router** matches the path. The **controller** calls one service method with
   `req.uid` plus params, query and body: `respond(req => service.publishAdvisory(req.uid, req.params.id))`.
6. The **use case** validates input with domain rules, loads the actor with
   `context.actor(uid)`, checks permission, then calls repositories.
7. The **repository** runs a query, or calls a SQL function with `rpc` for writes.
   Supabase errors are converted to app errors with a `status`.
8. The controller sends `res.json(result)`, or passes the error to `next(error)`.
9. **`errorHandler`** sends `{ error, code? }` with `error.status`, or logs the error and
   sends `500` with a general message.

The actor is always `req.uid` from the verified token. User IDs sent in the body or
query are never used to decide who is acting.

---

## 6. Folder and file structure

```text
<project-name>/
|-- server.js                     # Composition root: config, adapters, service, app, listen
|-- package.json
|-- package-lock.json
|-- .env.example                  # Setting names with comments (commit this)
|-- .env                          # Real values (git-ignored)
|-- .gitignore
|
|-- src/
|   |-- app.cjs                   # createApp({ service, auth, ... }): body limits, routers, error handler. No SDKs, no listen.
|   |-- config.cjs                # loadEnvFile() and readConfig(env): every setting, read in one place
|   |
|   |-- domain/                   # Pure rules: validation, normalising input, fail(message, status)
|   |   |-- agencyRules.cjs       # e.g. code(), email(), hotline(), stationInput()
|   |   |-- advisoryRules.cjs     # e.g. advisoryInput(), advisoryImageInput(), publicAdvisory()
|   |   `-- assistantRules.cjs    # (optional) message and history limits
|   |
|   |-- application/              # Use cases. Use only injected dependencies.
|   |   |-- createService.cjs     # Combines every use case into one service object
|   |   |-- createAgencyContext.cjs # Shared helpers: profile(uid), actor(uid), permit(...)
|   |   |-- useCases/
|   |   |   |-- agencyManagement.cjs  # createAgencyManagement(context) -> { list(uid), createAgency(uid, input), ... }
|   |   |   |-- advisories.cjs
|   |   |   `-- assistant.cjs     # (optional) ask(uid, input): the Claude tool loop
|   |   `-- assistant/            # (optional)
|   |       |-- systemPrompt.cjs  # Fixed system prompt: no dates or user data, so it can be cached
|   |       `-- tools.cjs         # Tool definitions and a runner that calls read-only use cases with the same uid
|   |
|   |-- infrastructure/           # The only place that imports SDKs
|   |   |-- supabase/
|   |   |   |-- createSupabaseDependencies.cjs  # One server client -> { repositories, auth, files }
|   |   |   |-- createAuth.cjs                  # verifyToken and admin user operations
|   |   |   |-- createFileStorage.cjs           # Storage bucket save and remove
|   |   |   |-- supabaseError.cjs               # toAppError(): Postgres/Auth error -> error with status
|   |   |   |-- repositories/
|   |   |   |   |-- profileRepository.cjs
|   |   |   |   |-- agencyRepository.cjs
|   |   |   |   `-- advisoryRepository.cjs      # Queries and rpc() calls for one resource
|   |   |   `-- listeners/                      # (optional) Realtime subscriptions started from server.js
|   |   |-- anthropic/
|   |   |   `-- createAnthropicDependencies.cjs # (optional) { ai }, or { ai: null } without a key
|   |   `-- push/                               # (optional) FCM sender for mobile notifications
|   |
|   `-- presentation/             # HTTP only
|       |-- controllers/
|       |   |-- agencyController.cjs     # respond(req => service.method(req.uid, ...))
|       |   `-- assistantController.cjs  # (optional)
|       |-- middleware/
|       |   |-- authenticate.cjs         # Bearer token -> req.uid
|       |   |-- rateLimit.cjs            # (optional) Per-user limit, in memory
|       |   `-- errorHandler.cjs         # error.status -> JSON; anything else -> 500 and a log line
|       `-- routes/
|           |-- agencyRoutes.cjs         # Path + method -> controller
|           `-- assistantRoutes.cjs      # (optional)
|
|-- supabase/
|   |-- config.toml               # Supabase CLI settings
|   |-- migrations/
|   |   `-- YYYYMMDDHHMMSS_<description>.sql
|   `-- tests/                    # (optional) pgTAP tests for RLS and SQL functions
|
|-- tests/
|   |-- app.test.cjs              # HTTP: token check, uid binding, status codes (fake service)
|   |-- service.test.cjs          # Use cases with in-memory repositories
|   `-- assistant.test.cjs        # (optional) Tool loop with a scripted fake ai
|
`-- docs/
```

### Naming conventions

| Item | Convention | Example |
|---|---|---|
| Domain rules | `<resource>Rules.cjs` | `advisoryRules.cjs` |
| Use case module | `<feature>.cjs` exporting `create<Feature>(context)` | `advisories.cjs` -> `createAdvisories` |
| Repository | `<resource>Repository.cjs` exporting `create<Resource>Repository(client)` | `advisoryRepository.cjs` |
| Controller | `<area>Controller.cjs` | `agencyController.cjs` |
| Routes | `<area>Routes.cjs` exporting `create<Area>Router(service)` | `agencyRoutes.cjs` |
| Middleware | `<concern>.cjs` | `authenticate.cjs` |
| Test | `tests/<area>.test.cjs` | `tests/service.test.cjs` |
| Migration | `YYYYMMDDHHMMSS_<snake_description>.sql` | `20261201000001_create_advisories.sql` |
| Table and column | `snake_case`, plural tables | `advisories.agency_id` |
| SQL function | verb first, `snake_case` | `publish_advisory` |

### Layer rules

| Layer | Responsible for | Must not |
|---|---|---|
| `domain/` | Input validation, normalising values, pure permission and business rules | Do I/O or read settings |
| `application/` | Loading the actor, permission checks, orchestration, side effects through dependencies | Use `req`/`res` or import an SDK |
| `infrastructure/` | SDK calls, queries, SQL function calls, error conversion, row-to-object mapping | Contain business decisions |
| `presentation/` | Token check, routes, status codes, response shape | Query data or hold business rules |
| `server.js` | Creating clients and wiring everything | Contain routes or rules |

---

## 7. Dependencies passed to use cases (ports)

`createService(dependencies)` receives these objects. Use cases only call the methods
listed here, so a test can replace each one with an in-memory fake.

| Dependency | Methods | Supabase / Anthropic implementation |
|---|---|---|
| `repositories.<resource>` | Reads such as `findById(id)`, `listForAgency(agencyId)`; writes such as `publish(actorId, id)` | Reads: `client.from(table).select(...)`. Writes that touch more than one row, or need an audit record: `client.rpc(fn, args)` |
| `auth.verifyToken(token)` | Returns `{ uid }` or throws | `client.auth.getUser(token)` |
| `auth.getUser(uid)` | Auth account details | `client.auth.admin.getUserById(uid)` |
| `auth.getUserByEmail(email)` | Auth account or `null` | Look up `profiles.email` (unique, lower-case), or call a SQL function over `auth.users` that only `service_role` can run |
| `auth.createUser(details)` | New account with its real UID | `client.auth.admin.createUser({ email, password, email_confirm, user_metadata })` |
| `auth.deleteUser(uid)` | Removes an account (cleanup only) | `client.auth.admin.deleteUser(uid)` |
| `files.save(path, buffer, contentType)` | Returns a URL | `client.storage.from(bucket).upload(path, buffer, { contentType, upsert: false, cacheControl: '3600' })`, then `getPublicUrl(path)` |
| `files.remove(path)` | Deletes a file | `client.storage.from(bucket).remove([path])` |
| `ai.createMessage(params)` **(optional)** | One Claude response | `client.beta.messages.create(...)` from `@anthropic-ai/sdk` (section 9.5) |
| `id()` | New unique ID | `crypto.randomUUID` |
| `now()` | Current time in ms | `Date.now` |

Notes:

- Repositories return the camelCase shapes the frontend already uses (`agencyId`, `updatedAt`),
  so moving data to Postgres doesn't change API responses.
- With email confirmation turned on in Supabase, an account created with `email_confirm: false`
  can't sign in until the user confirms the email.
- Never call `signInWithPassword` on the backend's client. It would switch that shared client
  to a user session. Users sign in from the frontend.

### Example repository

```js
// src/infrastructure/supabase/repositories/advisoryRepository.cjs
const { toAppError } = require('../supabaseError.cjs');

const toAdvisory = row => ({ id: row.id, title: row.title, status: row.status, agencyId: row.agency_id, updatedAt: row.updated_at });

function createAdvisoryRepository(client) {
  return {
    async listForAgency(agencyId) {
      let query = client.from('advisories').select('id, title, status, agency_id, updated_at').order('updated_at', { ascending: false });
      if (agencyId) query = query.eq('agency_id', agencyId);
      const { data, error } = await query;
      if (error) throw toAppError(error);
      return data.map(toAdvisory);
    },
    async publish(actorId, advisoryId) {
      const { error } = await client.rpc('publish_advisory', { p_actor_id: actorId, p_advisory_id: advisoryId });
      if (error) throw toAppError(error);
    },
  };
}

module.exports = { createAdvisoryRepository };
```

---

## 8. API conventions

- **Base path:** `/api/<area>`, for example `/api/agencies` and `/api/assistant`. There is no
  version prefix. Add the same paths to the frontend's development proxy and the
  production reverse proxy.
- **Access:** every route sits behind `authenticate`. The use case decides which roles may
  run it. There are no public routes. Public data is read from Supabase directly through RLS.
- **Methods:** `GET` for reads. `POST` for every write, with an action in the path when needed:

| Method and path | Purpose |
|---|---|
| `GET /api/agencies/advisories` | List what the actor may see |
| `POST /api/agencies/advisories` | Create or update (an `id` in the body means update) |
| `POST /api/agencies/advisories/:id/publish` | Action |
| `POST /api/agencies/advisories/:id/archive` | Action |
| `POST /api/agencies/advisories/:id/delete` | Action |

- **Route order:** register specific routes before catch-alls
  (`/:code/hotline` before `/:code/:collection`).
- **Body limits:** `20kb` by default. A larger limit only on the routes that need it.

### Response format

Success: a plain JSON object shaped for the screen that uses it.

```json
{ "data": {} }
{ "agencies": [], "invitations": [] }
{ "message": "Hotline saved." }
```

Error:

```json
{ "error": "Human-readable message", "code": "OPTIONAL_CODE" }
```

---

## 9. Cross-cutting subsystems

### 9.1 Authentication and roles

- The frontend signs in with Supabase Auth using the **publishable** key, then sends the
  access token as `Authorization: Bearer <token>`.
- `authenticate(auth)` checks the token with `auth.verifyToken` and sets `req.uid`:

```js
function authenticate(auth) {
  return async (req, res, next) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
    if (!token) return res.status(401).json({ error: 'Sign in required.' });
    try {
      req.uid = (await auth.verifyToken(token)).uid;
    } catch {
      return res.status(401).json({ error: 'Invalid or expired session.' });
    }
    next();
  };
}
```

- `auth.getUser(token)` asks Supabase Auth on every request, so a signed-out or deleted user
  is rejected at once (like `verifyIdToken(token, true)`). With asymmetric JWT signing keys,
  `auth.getClaims(token)` checks the token locally and is faster, but it accepts a token
  until it expires, even after sign-out.
- Roles live in `profiles.role`, never in `user_metadata`. Users can change their own
  `user_metadata`.
- `context.actor(uid)` loads the profile and requires `active = true` and an allowed role.
  For agency roles it also requires an active agency. `permit(actor, agencyId, systemOnly)`
  limits agency administrators to their own agency.
- Example roles: `SYSTEM_ADMIN` (everything), `COMMAND_ADMIN` (command center work),
  `AGENCY_ADMIN` (own agency only), `RESPONDER`.
- `profiles.active` controls access to the application. To block sign-in completely, also ban
  the Auth account with `auth.admin.updateUserById(uid, { ban_duration })`.
- The first `SYSTEM_ADMIN` is created by a trusted operator in SQL. The public UI can't create
  its own administrator.

### 9.2 Error handling

`errorHandler` only looks at `error.status`. Adapters convert SDK errors before they leave
`infrastructure/`.

| Source | HTTP status | Message shown |
|---|---|---|
| `fail(message, status)` in domain or application | That status (default 400) | The message |
| SQL function `raise ... using errcode = '42501'` | 403 | The function's message |
| SQL function `raise ... using errcode = 'P0002'` | 404 | The function's message |
| SQL function plain `raise exception` (`P0001`) | 400 | The function's message |
| Postgres `23505` (unique violation) | 409 | "This record already exists." |
| Postgres `23503` (foreign-key violation) | 409 | "A linked record is missing or still in use." |
| Postgres `22P02`, `23514` (invalid value, check failed) | 400 | "Invalid value." |
| Supabase Auth `email_exists` / `user_already_exists` | 409 | "An account with this email already exists." |
| Anthropic rate limit | 429 | "The assistant is busy. Try again in a minute." |
| Anthropic key rejected, connection failure, 5xx or overloaded | 503 | "The assistant isn't available right now." |
| Anything else | 500 | General message; method, path, code and message are logged |

Only messages written by us (domain rules and our SQL functions) are shown to users. Other
database messages are logged, not shown.

### 9.3 Atomic writes and audit records

A write that changes more than one row, or needs an audit record, is one SQL function.
The function runs in a single transaction, checks the actor again, and writes the audit
record with the change.

```sql
create or replace function public.publish_advisory(p_actor_id uuid, p_advisory_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_advisory public.advisories;
begin
  select * into v_actor from public.profiles where id = p_actor_id for share;
  if not found or not v_actor.active or v_actor.role not in ('SYSTEM_ADMIN', 'COMMAND_ADMIN', 'AGENCY_ADMIN') then
    raise exception 'Administrator permission required.' using errcode = '42501';
  end if;

  select * into v_advisory from public.advisories where id = p_advisory_id for update;
  if not found or (v_actor.role = 'AGENCY_ADMIN' and v_advisory.agency_id is distinct from v_actor.agency_id) then
    raise exception 'Advisory not found.' using errcode = 'P0002';
  end if;

  update public.advisories
     set status = 'PUBLISHED', published_at = now(), updated_at = now()
   where id = p_advisory_id;

  insert into public.audit_logs (actor_id, resource_id, agency_id, action)
  values (p_actor_id, p_advisory_id, v_actor.agency_id, 'ADVISORY_PUBLISHED');
end;
$$;

-- Supabase lets anon and authenticated run new public functions by default. Only the backend may run this one.
revoke execute on function public.publish_advisory(uuid, uuid) from public, anon, authenticated;
grant execute on function public.publish_advisory(uuid, uuid) to service_role;
```

Rules:

- The use case validates input and checks permission first (clear messages, no wasted call).
  The function checks again inside the transaction, so a role change in between can't slip through.
- Declare `role` and `active` as `not null` so the checks above can't be bypassed by a null.
- Supabase Auth and the database can't commit together. When a use case creates an Auth
  account and then saves the profile, a failed save deletes the new account. If cleanup fails,
  the API returns a message telling the administrator what to fix.
- Don't use a trigger on `auth.users` to assign roles. If you add one, it may only create an
  inactive profile with no role.

### 9.4 File uploads

- The frontend sends images as base64 JSON (`{ contentType, data }`) on a route with a larger
  body limit. No multipart parser is needed.
- Domain rules check the type against an allowlist (JPG, PNG, WebP), check the size (3 MB),
  and check the file's first bytes match its type.
- The use case saves the file with `files.save(path, buffer, contentType)` and stores the URL.
  If the database step fails, it removes the file. A leftover file is harmless; a record
  pointing at a missing file is not.
- Use a public bucket for images that citizens see (`getPublicUrl`). Use a private bucket and
  `createSignedUrl(path, seconds)` for anything else.

### 9.5 AI assistant (optional)

```text
POST /api/assistant/chat   { message, history: [{ role, text }] }
  -> authenticate -> rateLimit (per uid) -> assistantController
  -> service.ask(uid, input)
       assistantInput(input)   message up to 2,000 characters; up to 20 history turns,
                               text only, alternating user/assistant and starting with user
       actor(uid)              active staff only
       loop, at most 5 rounds:
         ai.createMessage({ system, tools, messages })
         tool_use -> run each tool with the same uid -> tool_result
  -> { answer, toolsUsed }
```

**Tools**

- Every tool is read-only and calls an existing use case with the caller's `uid`, for example
  `service.dashboard(uid)` or `service.agencyDirectory(uid)`. The assistant can never see more
  than the user's own screens show.
- No write tools in the first version, and never a tool that runs free-form SQL.
- Return only the fields the answer needs. Leave out phone numbers, emails and other contact details.
- Incident descriptions are written by citizens. The system prompt says text inside tool
  results is data, not instructions.
- Set `strict: true` on each tool, with `additionalProperties: false` and `required` in its schema.
- Leave `tool_choice` unset. Forcing a tool returns an error on current models; steer from the prompt.

**Model settings**

| Setting | Value | Why |
|---|---|---|
| `model` | `claude-opus-5-5` (`ANTHROPIC_MODEL`) | Current default model |
| `output_config.effort` | `low` | Chat answers don't need deep reasoning; lower cost and latency |
| `thinking` | Not sent | Always on for this model; effort controls it |
| `temperature` | Not sent | Current models reject it |
| `max_tokens` | `16000` | Room for thinking and the answer without cutting it off |
| `fallbacks` | `"default"` (beta `server-side-fallback-2026-07-01`) | If the model declines a request, the API retries it on a fallback model |
| `cache_control` | `{ type: 'ephemeral' }` | Caches the fixed tools and system prompt, and earlier turns |

**Caching and history**

- Keep `tools` and the system prompt exactly the same on every request. Put the user's role,
  agency and today's date in the newest user message, not in the system prompt.
- Inside the loop, add `response.content` back unchanged (it carries thinking blocks the
  next request needs). The history the client sends back is plain text only.
- Caching starts once the fixed part is long enough. Check `usage.cache_read_input_tokens`
  in the logs to confirm.

**Adapter**

```js
// src/infrastructure/anthropic/createAnthropicDependencies.cjs
const { Anthropic, APIConnectionError, APIError, AuthenticationError, PermissionDeniedError, RateLimitError } = require('@anthropic-ai/sdk');

const appError = (message, status) => Object.assign(new Error(message), { status });

function toAppError(error) {
  if (error instanceof RateLimitError) return appError('The assistant is busy. Try again in a minute.', 429);
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    console.error('Anthropic credentials rejected:', error.status);
    return appError("The assistant isn't available right now.", 503);
  }
  // APIConnectionError extends APIError, so check it first.
  if (error instanceof APIConnectionError) return appError("The assistant isn't available right now.", 503);
  if (error instanceof APIError && error.status >= 500) return appError("The assistant isn't available right now.", 503);
  return error; // A 400 here is our bug: errorHandler logs it and returns 500.
}

function createAnthropicDependencies(config) {
  const { apiKey, model, effort } = config.anthropic;
  if (!apiKey) return { ai: null };
  const client = new Anthropic({ apiKey });
  return {
    ai: {
      async createMessage({ system, tools, messages }) {
        try {
          return await client.beta.messages.create({
            model,
            max_tokens: 16000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: { effort },
            cache_control: { type: 'ephemeral' },
            system,
            tools,
            messages,
          });
        } catch (error) {
          throw toAppError(error);
        }
      },
    },
  };
}

module.exports = { createAnthropicDependencies };
```

**Use case loop**

```js
// src/application/useCases/assistant.cjs (inside createAssistant(context, service))
async ask(uid, input) {
  if (!ai) fail("The assistant isn't set up yet.", 503);
  const operator = await actor(uid);
  const { message, history } = assistantInput(input);
  const runTool = createToolRunner(service, uid);
  const messages = [
    ...history.map(turn => ({ role: turn.role, content: turn.text })),
    { role: 'user', content: [{ type: 'text', text: contextLine(operator, now()) }, { type: 'text', text: message }] },
  ];
  const toolsUsed = [];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await ai.createMessage({ system: SYSTEM_PROMPT, tools: TOOLS, messages });
    if (response.stop_reason === 'refusal') return { answer: "I can't help with that request.", toolsUsed };
    if (response.stop_reason !== 'tool_use') return { answer: textOf(response), toolsUsed };
    messages.push({ role: 'assistant', content: response.content });
    const calls = response.content.filter(block => block.type === 'tool_use');
    const results = await Promise.all(calls.map(async call => {
      toolsUsed.push(call.name);
      try {
        return { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(await runTool(call.name, call.input)) };
      } catch (error) {
        return { type: 'tool_result', tool_use_id: call.id, content: error.status ? error.message : 'The lookup failed.', is_error: true };
      }
    }));
    messages.push({ role: 'user', content: results }); // all results in one message
  }
  fail('The assistant could not finish. Try a shorter question.', 422);
}
```

`createService` builds the other use cases first, then passes the finished service to
`createAssistant(context, service)` so tools can call them.

**Logging and limits**

- Log one JSON line per question: uid, rounds, tool names, input and output tokens, duration.
  Never log the question or the answer.
- Without `ANTHROPIC_API_KEY` the server still starts and the route returns `503`.
- The frontend labels answers as AI-generated.

### 9.6 Rate limiting

Arcjet isn't used yet. A small in-memory limiter runs after `authenticate`, so the limit
is per user:

```js
// src/presentation/middleware/rateLimit.cjs
function rateLimit({ max, windowMs }, now = Date.now) {
  const hits = new Map();
  return (req, res, next) => {
    const time = now();
    const entry = hits.get(req.uid);
    if (!entry || time - entry.start >= windowMs) {
      hits.set(req.uid, { start: time, count: 1 });
      return next();
    }
    if (entry.count >= max) {
      res.set('Retry-After', String(Math.ceil((entry.start + windowMs - time) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }
    entry.count += 1;
    next();
  };
}
```

It only works with one server instance and resets on restart. When Arcjet is added, it
replaces this middleware in the same position.

### 9.7 Live updates (Supabase Realtime)

- The frontend subscribes to table changes with Supabase JS. Realtime applies RLS, so each
  user only receives rows their `select` policies allow.
- Add each live table to the publication:
  `alter publication supabase_realtime add table public.incidents;`
- The backend doesn't relay live events, so there is no event stream to scale.

### 9.8 Background listeners (optional)

For work that reacts to new rows, such as sending push notifications for new warnings:

- Put the subscription in `src/infrastructure/supabase/listeners/` and start it from `server.js`.
  It calls a use case; the use case decides who to notify.
- Mark rows as handled (`notified_at`) in the same update that records success. On startup,
  process rows where `notified_at is null`, because events sent while the server was down are missed.
- Like the rate limiter, this works with one server instance. For more, use a Supabase
  Database Webhook or a queue table read with `for update skip locked`.

### 9.9 Logging

- Unknown errors: method, route path, error code and message. No request bodies, tokens or passwords.
- Passwords go only to Supabase Auth. They are never saved in tables, audit records or logs,
  and never returned by the API.

---

## 10. Data architecture (Supabase)

### Keys

| Key | Where | Notes |
|---|---|---|
| Publishable key (`sb_publishable_...`, or the legacy anon key) | Frontend and mobile | Safe to ship; RLS limits what it can do |
| Secret key (`sb_secret_...`, or the legacy `service_role` key) | Backend `.env` only | Bypasses RLS. Never put it in a `REACT_APP_*` variable or any client build |

The backend uses the secret key because it creates Auth accounts and writes data that
clients may not write. The application layer is therefore the main permission check for API
writes. RLS protects every table from direct client access, and SQL functions check again.

### Baseline tables

| Table | Purpose |
|---|---|
| `profiles` | One row per Auth user (`id` = `auth.users.id`): `role`, `agency_id`, `station_id`, `active`, `display_name`, `email` |
| `audit_logs` | `actor_id`, `target_id`, `resource_id`, `agency_id`, `action`, `created_at`; written only by SQL functions |
| `<resource>` | Domain tables with `id uuid default gen_random_uuid()`, `created_at`, `updated_at` and, if needed, `deleted_at` or a `status` |

Use `timestamptz` for times. Repositories convert to the format the frontend expects.

### Example (ERA): where today's Firebase data would go

A starting point for planning, not a migration script.

| Firebase path today | Supabase table |
|---|---|
| `server/City of Tabuk/users/{uid}`, legacy `users/{uid}` | `profiles` |
| `.../agency/{agencyId}/profile` | `agencies` |
| `.../agency/{agencyId}/members`, `/responders` | `profiles.agency_id`, plus `responder_details` |
| `.../agency/{agencyId}/stations`, `.../stations`, legacy `stations` | `stations` (with `agency_id`) |
| `teams` | `teams` |
| `agency_invitations`, `admin_invitations` | `invitations` |
| `incidents`, `incident_events` | `incidents`, `incident_events` |
| `dispatch_assignments` | `dispatch_assignments` |
| `.../command_center/response_reports` | `response_reports` |
| `.../advisories`, `.../public_advisories` | `advisories`, plus `public_advisories` (public fields only) |
| `.../shared_locations/{uid}` | `shared_locations` (`user_id` primary key) |
| `.../command_center/audit_logs`, `audit_logs` | `audit_logs` |
| `.../warning`, `notification_jobs` | `warnings` (with `notified_at`), `notification_jobs` |

### Baseline database objects

| Object | Kind | Purpose |
|---|---|---|
| `set_updated_at` | Trigger function | Keeps `updated_at` current on every table |
| `current_profile_role()` / `is_staff()` | RLS helpers | Role checks inside policies; `security definer`, `stable`, `set search_path = ''` |
| `<verb>_<resource>` | SQL function | Atomic writes with permission re-check and audit record (section 9.3) |

### Security rules

- Turn on RLS for every table, including tables only the backend uses (no policies means no client access).
- Add `select` policies only for what clients read directly: their own profile, published
  advisories, live operational tables for active staff.
- Add client `insert`/`update`/`delete` policies only for data the user owns, such as their
  own `shared_locations` row. Everything else is written through the API.
- Write policy helpers as `(select auth.uid())` and `(select public.is_staff())` so Postgres
  runs them once per statement.
- Revoke `execute` on backend-only SQL functions from `public`, `anon` and `authenticated`.

---

## 11. Environment variables

All settings are read in `src/config.cjs`. Values set in the host environment win over `.env`.

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | No (default `5000`) | HTTP port. Match it in the frontend's proxy settings |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Yes | Server-only secret key (or legacy `service_role` key) |
| `SUPABASE_STORAGE_BUCKET` | For uploads | Bucket for images |
| `ANTHROPIC_API_KEY` | For the assistant | Empty turns the assistant off (`503`) |
| `ANTHROPIC_MODEL` | No (default `claude-opus-5-5`) | Model override |
| `AI_RATE_LIMIT_MAX` | No (default `20`) | Questions per window per user |
| `AI_RATE_LIMIT_WINDOW_MS` | No (default `600000`) | Window length (10 minutes) |
| `CORS_ORIGINS` | No | Only when the API isn't same-origin: comma-separated exact origins |

```js
// src/config.cjs (shape)
function readConfig(environment = process.env) {
  return {
    port: pick(environment.PORT) || 5000,
    supabase: {
      url: pick(environment.SUPABASE_URL),
      secretKey: pick(environment.SUPABASE_SECRET_KEY),
      storageBucket: pick(environment.SUPABASE_STORAGE_BUCKET),
    },
    anthropic: {
      apiKey: pick(environment.ANTHROPIC_API_KEY),
      model: pick(environment.ANTHROPIC_MODEL) || 'claude-opus-5-5',
      effort: 'low',
    },
    assistantRateLimit: {
      max: Number(pick(environment.AI_RATE_LIMIT_MAX)) || 20,
      windowMs: Number(pick(environment.AI_RATE_LIMIT_WINDOW_MS)) || 10 * 60 * 1000,
    },
  };
}
```

The frontend gets `SUPABASE_URL` and the publishable key in its own env file. Commit
`.env.example` with names and comments only. Never commit real values.

---

## 12. npm scripts and commands

```json
"scripts": {
  "start": "node server.js",
  "dev": "node --watch server.js",
  "test": "node --test tests/*.test.cjs"
}
```

| Command | What it does |
|---|---|
| `npm ci` | Install dependencies from the lockfile |
| `npm run dev` | Start with auto-restart |
| `npm start` | Start the server |
| `npm test` | Run unit and HTTP tests |
| `supabase start` | Run Supabase locally |
| `supabase migration new <name>` | Create a migration file |
| `supabase db reset` | Rebuild the local database from migrations |
| `supabase test db` | Run pgTAP tests in `supabase/tests` |
| `supabase db push` | Apply migrations to the linked project |

---

## 13. Testing

- `tests/service.test.cjs` builds the service with in-memory repositories, a fake `auth`,
  fake `files`, a fixed `id()` and `now()`. It never contacts Supabase.
- `tests/app.test.cjs` starts `createApp({ service, auth })` on port `0` with a fake service and checks:
  missing or invalid tokens get `401`; the service receives the verified uid, not one sent in
  the body; errors keep their status and message.
- `tests/assistant.test.cjs` uses a fake `ai` that returns scripted responses (a `tool_use`,
  then an answer). It checks tools run with the caller's uid and that limits are enforced. It never calls Anthropic.
- SQL functions and RLS policies are tested against local Supabase with `supabase test db`.
- Tests against a real Supabase project, or calls to the real Anthropic API, are manual
  and need approval first.

---

## 14. Checklist: adding a new feature

1. **Migration:** `supabase migration new <name>`. Add the table, constraints, indexes, the
   `updated_at` trigger and RLS. Add policies only for direct client reads. Add a SQL function
   for each multi-step write, with `revoke`/`grant`.
2. **Domain:** validation in `src/domain/<resource>Rules.cjs`, using `fail(message, status)`.
3. **Repository:** `src/infrastructure/supabase/repositories/<resource>Repository.cjs`.
   Register it in `createSupabaseDependencies.cjs`.
4. **Use case:** `src/application/useCases/<feature>.cjs`. Register it in `createService.cjs`.
5. **HTTP:** controller method and route. Specific routes before catch-alls. Mount a new area in `app.cjs`.
6. **Tests:** service test with an in-memory repository; HTTP test for a new route.
7. **Settings and docs:** `.env.example` and `config.cjs` for new settings; proxy paths for a new area.
8. **Assistant (optional):** if the data helps answer questions, add a read-only tool that
   calls the new use case with the same uid.

---

## 15. Known constraints and not included yet

- The rate limiter and background listeners keep state in memory, so they only work with one
  server instance.
- Base64 uploads pass through the API's memory. Keep the 3 MB limit.
- Supabase Auth and the database can't commit together. Use cases clean up a new Auth account
  when the database save fails.
- The secret key bypasses RLS. Keep it out of every client build, and keep permission checks
  in both the use case and the SQL function.
- `auth.getUser(token)` makes a call to Supabase Auth on every request. This is fine for
  admin traffic.
- Every assistant question costs money, and answers can be wrong. Keep the rate limit and
  low effort, and label answers as AI-generated.
- **Not included yet:** Arcjet (bot protection and rate limiting), streamed assistant replies,
  assistant write actions, saved assistant conversations.
