# Rulebreaker release surface

This document describes the small release boundary for the Vite site and its same-origin API. The app remains usable in prepared mode without credentials. A public deployment does not imply that a provider is configured, enabled, or exercised.

## Source and build

Use Node.js 22.x (22.12 or newer) and install from the lockfile:

```sh
npm ci
npm run verify
npx playwright install chromium
npm run test:e2e
```

`@playwright/test` is pinned in `package.json` and `package-lock.json`. The browser suite runs the bundled Chromium engine in desktop and Pixel 5 projects, uses the running Vite app, and exports a real `rulebreaker/experiment/v1` snapshot before reset/import and replay checks. CI uploads the HTML report plus failure traces/videos for 14 days.

## Same-origin routes

The local Vite server and Vercel functions share the same handlers:

- `GET /api/health` returns the service schema, prepared/live capability flags, and the enforced request, response, token, and timeout limits.
- `GET /api/capabilities` returns the same capability document for clients that need a descriptive name.
- `POST /api/interpret` accepts a bounded prompt plus validated scene and returns a validated typed law when the operator gate is open.

API errors are short, stable, and sanitized. Provider URLs, status text, credentials, request bodies, and upstream response content are never returned to the browser. Disconnecting a request aborts provider work when the runtime exposes the request close signal; a timeout also aborts the provider request.

## Provider spend gate

Live AI is fail-closed. It remains unavailable unless every required condition is true:

```text
RULEBREAKER_LIVE_AI_ENABLED=true
RULEBREAKER_OPERATOR_BEARER_TOKEN=<operator-held token>
RULEBREAKER_AI_API_KEY=<provider key>
RULEBREAKER_AI_BASE_URL=https://api.openai.com/v1
RULEBREAKER_AI_MODEL=gpt-4o-mini
```

The operator token is supplied per request as `Authorization: Bearer <token>`. A missing or false enable flag returns a disabled response before the request body is read. A missing or incorrect token returns an authorization response before provider work begins. Keep the enable flag false or unset for prepared-only hosting. No credential is stored in source, the browser bundle, or this repository.

Provider URL and model come only from trusted server configuration, never a client prompt or model proposal. URLs require HTTPS and cannot contain userinfo, queries, or fragments. A loopback HTTP provider can be enabled with `RULEBREAKER_AI_ALLOW_LOCAL_HTTP=true` only outside production/Vercel. The optional browser panel accepts an operator-held access token in volatile page memory, clears it on Reset, and never accepts a provider key.

The adapter enforces a 32 KiB request-body limit, an 8-second body-read deadline, a streamed 32 KiB provider-response limit, a 256-token provider output cap, and an 8-second provider timeout. Disconnect interrupts body reading as well as provider work. Oversized requests return a sanitized 413; stalled body reads return 408 and close the connection. It validates the complete response against the scene and law schema before returning it. Prepared interpretation never calls this route.

## Hosting headers

`vercel.json` applies same-origin security headers, including a restrictive content policy with `wasm-unsafe-eval` and blob workers for Rapier’s WebAssembly runtime. It does not enable cross-origin isolation, so the bundled physics runtime is not blocked by missing cross-origin resource headers. The browser API remains same-origin and uses `no-store` responses.

## Release evidence

Record the exact source commit, the local `npm run verify` result, the desktop/mobile browser result, and the served deployment commit separately. A successful build or Vercel deployment proves source/host behavior only; it does not prove provider adoption or a live AI engine effect. Keep the operator gate closed until a reviewed owner enables it and can read back the intended provider behavior.

Vercel's function compiler uses the root `tsconfig.json` and does not follow the solution's project references. Its Node/strict options are explicit there; local browser and server checks also use their focused referenced configurations. Node is pinned to the tested 22.x major.

## Deploy and roll back

Use the existing Git-linked Vercel project and the authorized maintainer account. Land reviewed source through the repository's merge owner, then test its preview before promoting it. Read `GET /api/health` and compare `revision` to the deployed Git commit; require `prepared: true` and `liveAi: false` for this prepared-only release. Verify the security headers and actual Wasm room in the served browser.

Run the same acceptance suite against a served URL without starting a local server:

```sh
RULEBREAKER_E2E_BASE_URL=https://<verified-deployment> npm run test:e2e
```

The same existing GitHub workflow accepts a `deployment_url` manual input. Dispatch it from the exact landed ref to offload hosted desktop/mobile acceptance; it also checks the served health revision against that workflow's source commit. Keep production live AI disabled for this suite.

Record the deployment ID and its exact commit before promotion. `vercel promote <verified-deployment-url> --scope <team>` promotes an existing artifact. For a subsequent release regression, `vercel rollback <previous-good-deployment-url> --scope <team>` selects the recorded previous artifact; read the production health revision again and rerun browser acceptance. On the first release there is no earlier known-good production artifact: use the reviewed release tag to redeploy, or remove traffic through the hosting owner's route. Do not invent a prior rollback target.

Git deployments use `VERCEL_GIT_COMMIT_SHA`. When deploying an exact clean checkout through the CLI, supply `--env RULEBREAKER_RELEASE_REVISION=<full-reviewed-sha>` and `--meta githubCommitSha=<full-reviewed-sha>`; CLI uploads may have no automatic Git system variable. Health accepts only a full lowercase commit SHA and otherwise reports `null`. The stamp is an operator attestation of the uploaded checkout: verify its clean state, reviewed commit, build result, and deployment ID together.

CI actions are pinned to owner commit SHAs. Update those pins and the dependency lockfile in a reviewed PR, and rerun the same release gates.
