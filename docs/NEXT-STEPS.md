# First product build

## Physics slice delivered

A real Three.js/Rapier room with orbit camera controls, four selectable sample objects, a validated gravity law, collision-note events with a threshold/cooldown/voice policy, simulation-tick freeze expiry, visible prepared-law interpretation, explicit sound activation, reset, and engine/schema tests.

## Experiment slice delivered

Versioned `rulebreaker/experiment/v1` snapshots now capture scene identity, physics transforms/velocities, active laws, freeze timers, collision cooldowns, pending events, note sequence, and selection. Undo, one branch, export JSON, reset, and validated import restore the actual room without a provider request. Invalid versions and broken references are refused before mutation.

## First work for the build agent

Add the server-side AI law adapter. The prepared collision sound, temporary interaction rules, and experiment loop are now part of the engine; keep their provider-free behavior separate from the live-AI path.

Use the complete [build prompt](BUILD-PROMPT.md) for sequencing and acceptance. Finish a coherent vertical slice before adding a platform, accounts, multiplayer, or billing. The no-key prepared mode is an honest baseline; a real configured provider must be exercised separately before live AI is described as verified.
