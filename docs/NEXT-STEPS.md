# First product build

## Physics slice delivered

A real Three.js/Rapier room with orbit camera controls, four selectable sample objects, a validated gravity law, collision-note events with a threshold/cooldown/voice policy, simulation-tick freeze expiry, visible prepared-law interpretation, explicit sound activation, reset, and engine/schema tests.

## Experiment slice delivered

Versioned `rulebreaker/experiment/v1` snapshots now capture scene identity, physics transforms/velocities, active laws, freeze timers, collision cooldowns, pending events, note sequence, and selection. Undo, one branch, export JSON, reset, and validated import restore the actual room without a provider request. Invalid versions and broken references are refused before mutation.

## Live adapter slice delivered

`server/ai.ts` and the local Vite middleware now provide an optional OpenAI-compatible request path. The UI keeps live proposals separate from prepared mode, requires explicit apply approval, validates the response against the typed law schema, and fails closed when no provider is configured. The real-provider request → validated law → engine effect check is still outstanding until authorized provider configuration is present.

## Guided demo slice delivered

The no-key room now includes a three-step Impossible Room route: collision-note policy, inverted blue gravity, and selected-body freeze. It reports progress live and leaves the prepared controls ready for a variation after completion.

## First work for the build agent

Exercise one configured compatible provider through the browser and record the applied engine effect. The prepared collision sound, temporary interaction rules, experiment loop, and adapter boundary are now part of the engine; keep their provider-free behavior separate from the live-AI path.

Use the complete [build prompt](BUILD-PROMPT.md) for sequencing and acceptance. Finish a coherent vertical slice before adding a platform, accounts, multiplayer, or billing. The no-key prepared mode is an honest baseline; a real configured provider must be exercised separately before live AI is described as verified.
