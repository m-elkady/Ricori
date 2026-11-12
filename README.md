# Ricori Document Processing Service

A small TypeScript backend you are taking over. Read [CHALLENGE.md](CHALLENGE.md) before changing the code. All identities and documents are synthetic. This is a local hiring exercise, not a production deployment.

## Start with Docker

Prerequisites: Docker Engine/Desktop running **Linux containers**, Docker Compose v2.20+ (v5 also works), and free localhost ports 3100 and 55432. No host Node installation, cloud account or API key is needed. The first build downloads public images and npm packages.

From this directory:

```sh
docker compose up --build --wait api worker
docker compose ps
docker compose exec api npm run smoke
docker compose run --rm tests
```

The image installs dependencies and compiles as the non-root `node` user. To rebuild in a running container, use `docker compose exec api npm run build`; the test service checks write permissions before compiling again. After changing host source, rebuild the image as described below.

The database health check runs before setup. Setup applies migrations and seeds, then the API and worker start. The API health check waits for database connectivity. Repeating setup is safe.

API: `http://localhost:3100`. PostgreSQL: `localhost:55432`, database/user `ricori`, password `ricori_local_only`.

```sh
docker compose logs --tail=100 api worker setup
docker compose down
```

`down` preserves your database. To discard only this exercise's Compose database volume and start fresh, run `docker compose down --volumes`, then the startup command again. Do not reuse the Compose project name or database URL of another project.

If ports are occupied, change the host-side port in `compose.yaml`. For an API port change, also set `API_URL` when running the smoke script on your host. A Docker connection error means the engine is not running; start Docker Desktop and check `docker info`. On Windows, complete the Docker/WSL prerequisites first.

## Run Node on your host

Use Node **26 LTS** (the pinned build uses 26.13.1) and PostgreSQL 17. You may start only the database with `docker compose up -d --wait db`, or use a dedicated existing local PostgreSQL database. Do not run the Compose API/worker at the same time on the same port.

```sh
npm ci
npm run build
```

Set the connection in every terminal. PowerShell:

```powershell
$env:DATABASE_URL = 'postgres://ricori:ricori_local_only@127.0.0.1:55432/ricori'
```

Bash/zsh:

```sh
export DATABASE_URL='postgres://ricori:ricori_local_only@127.0.0.1:55432/ricori'
```

Then:

```sh
npm run migrate
npm run seed
npm test
npm start
```

In a second terminal with the same `DATABASE_URL`, run `npm run worker`. In a third terminal, run `npm run smoke`. `.env.example` is documentation; the application does not automatically load `.env`. Set variables as shown above.

After code edits run `npm run build` and restart the relevant processes, or rebuild with Compose. To process at most one available job: `npm run worker -- --once`. To target a job: `npm run worker -- --once --job=UUID`.

## Example request

```sh
curl -H "Authorization: Bearer alice-local-token" -H "Content-Type: application/json" --data-binary @scripts/example-document.json http://localhost:3100/documents
```

In Windows PowerShell use `curl.exe`. Copy the returned `document.id` into requests described in [API.md](API.md). The independent worker processes the submitted source without external services. Its idle polling interval is 250 ms; extraction itself has no artificial delay.

Demo identities:

| Person / tenant | Bearer token |
| --- | --- |
| Alice Example | `alice-local-token` |
| Bob Example | `bob-local-token` |

The simplified local identity model has one user and API key per tenant. The server derives the tenant from the authenticated key. Seed also creates one reviewed sample document for Alice. Seed reruns do not replace existing records.

## Code map

| Area | Files |
| --- | --- |
| HTTP and identity | `src/app.ts`, `src/server.ts`, `src/auth.ts` |
| Document actions | `src/documents.ts`, `src/domain.ts` |
| Processing and persistence | `src/worker.ts`, `src/processor.ts`, `src/results.ts` |
| Overview and cached reads | `src/listing.ts`, `src/read-cache.ts` |
| Durable queue | `src/queue.ts` |
| Database setup | `src/db.ts`, `src/migrate.ts`, `src/seed.ts`, `migrations/` |
| Baseline checks | `test/basic.test.ts`, `scripts/smoke.mjs` |

The queue uses PostgreSQL. Jobs have a payload snapshot, a lease and a retry budget of five attempts. A process can stop between steps; deliveries can therefore occur more than once. Processing history and the current document are separate records. There is no Redis or third-party processing service.

## Tests

`npm test` compiles and runs integration tests using real PostgreSQL. Each run creates a random schema, runs migrations and seeds twice, and removes only that schema afterward. The database user needs schema creation privileges. Optional `TEST_DATABASE_URL` overrides `DATABASE_URL` for tests. Tests do not truncate your normal data and can run while the standard worker runs.

`npm run smoke` exercises the running HTTP API and background worker. It creates and removes its own synthetic document. `API_URL` defaults to `http://127.0.0.1:3100`.

The baseline suite covers ordinary behavior. Add focused evidence for the changes you make. A full product rewrite is not expected; incomplete solutions with clear findings and limitations are accepted. Installation and build output are generated locally and excluded from the distributed source archive.
