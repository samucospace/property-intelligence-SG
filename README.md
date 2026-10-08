# Singapore Home Intel

Private residential transaction and rental analytics for Singapore. Current scope: **protected analytics-only staging**; public launch remains NO-GO. Lead collection, adviser referrals and customer email remain disabled.

## Project guidance

These are the three canonical documents. Read them in order when beginning work:

1. [AGENTS.md](AGENTS.md) — working rules, scope boundaries and documentation maintenance.
2. [Product specification](docs/PRODUCT_SPEC.md) — approved metrics, filters, map behavior and coverage limits.
3. [Operations](docs/OPERATIONS.md) — dated deployment inventory, safe procedures and remaining release gates.

[Historical archive](docs/archive/README.md) preserves earlier plans/reports. [Usability testing plan](docs/research/USER_TESTING_PLAN.md) is a current research reference, not completed research. Dated verification artifacts remain under `audit/`.

## Local development

Use Node **22.23.3** and npm 10 or later, matching the supported release runtime and lockfiles.

```sh
npm ci
npm --prefix server ci
npm --prefix client ci
```

Create private local configuration from [the server example](server/.env.example); keep read-only scope and disabled external jobs. Never commit credentials/databases or use operational data for tests. Review the operations guide before starting processes or preparing fixtures.

Run these in separate terminals for local development:

```sh
npm run dev:server
```

```sh
npm run dev:client
```

`npm test` runs isolated server tests; `npm run build` builds the client. Express serves the built frontend for production. Deployment uses a separate maintenance scheduler and persistent SQLite storage; the hosted compose configuration and recovery/launch requirements are documented in operations.

## Maintaining documentation

Update the three canonical documents in place. Keep research and dated evidence separate. Do not create another root completion report for a routine fix. Historical documents are preserved for traceability and must not be followed as current deployment instructions.
