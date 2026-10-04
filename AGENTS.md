# Rulebreaker agent entry point

## Begin here

Read README.md, docs/NEXT-STEPS.md, docs/ARCHITECTURE.md, and the full docs/BUILD-PROMPT.md before selecting a feature. Preserve the explicit distinction between prepared play and live AI. The repo is independent of other creative projects and private runtime services.

## Ownership and execution

Inspect the current branch, dirty work, existing PRs, and applicable host instructions. You are not alone: preserve other people's edits, use an isolated branch/worktree when needed, and assign explicit file ownership if delegating. Use the repository's required merge/release front doors. New branches default to codex/; commits and PR titles use truthful Conventional Commits.

## Implementation boundaries

`src/domain.ts` owns scene/law/experiment validation; `src/simulation.ts` owns the physics instance; `src/World.tsx` owns rendering; `src/scene.json` is the sample scene. `server/api.ts` owns the shared production/development request boundary, and `server/ai.ts` owns provider calls. Follow docs/RELEASE.md for browser acceptance, hosting, and rollback.

Validate untrusted imports and future model output before effects. Keep keys server-side. The current no-key demo must remain usable. Do not add a dependency on sibling repos or private services, fabricate live responses, or weaken a failing check.

## Proof

Run npm run verify for relevant changes. Exercise the actual browser controls for UI changes; for audio inspect rendered output as well as state. Follow the full build prompt's acceptance criteria as each feature arrives. A schema pass, mock, merged PR, or build is not proof of a real provider, rendered experience, deployment, or release. Record exact source revision and failures/skips in handoff.
