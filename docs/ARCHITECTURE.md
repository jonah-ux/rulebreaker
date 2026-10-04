# Rulebreaker architecture

A single Vite/React/TypeScript application with independent npm dependencies and a lockfile. Zod validates the versioned scene, law, event, and experiment formats. Prepared mode has no credential or provider dependency; the local Vite server optionally mounts one bounded provider route.

`src/domain.ts` owns scene/law/event/experiment validation. `src/preparedInterpreter.ts` owns deterministic no-key natural-language composition and refusal of unsupported phrases. `src/simulation.ts` owns the Rapier instance, fixed-step state, and atomic snapshot restore. `src/World.tsx` owns rendering, camera controls, raycast selection, animation, and history actions. `src/App.tsx` owns the prepared interaction panel, browser audio activation, local export/import surface, proposal approval, and the bounded event ledger. `src/scene.json` is the sample scene.

## Law format

Every law carries `schema: rulebreaker/law/v1`, an explicit `operation`, and a bounded list of object IDs. The current operations are:

- `set-gravity-scale`: apply a finite scale from −2 to 2 to selected bodies.
- `collision-note`: observe selected bodies at a finite impact threshold, with an integer cooldown and voice limit.
- `temporary-freeze`: lock selected bodies for a bounded number of simulation ticks, then restore dynamic translation, rotation, and zero velocity.

`validateLaw` parses the complete discriminated union and checks every target against the scene before `simulation.apply` mutates the world. A mixed valid/invalid selection therefore leaves the previous state unchanged. Gravity and collision-note laws compose; a later gravity law changes the selected body's scale while a temporary freeze only locks motion until its expiry.

## Simulation events

Rapier advances at a fixed 1/60-second step. Collision events are collected through `EventQueue`, filtered by target and relative impact speed, and emitted as bounded `collision-note` events with a deterministic rotating frequency. A pair cooldown prevents persistent contacts from becoming an unbounded event stream. Freeze expiry is measured in the same simulation ticks, so the timer remains independent of render-frame pacing. The browser presentation consumes these events and schedules short Web Audio voices only after an explicit user gesture.

The stage control surface exposes that same clock for inspection. `Pause room` clears the render accumulator and stops calls to `simulation.step`; `Step 1 tick` is accepted only while paused and consumes one nonce so one click produces one Rapier step, one clock increment, and one event-ledger entry. Resuming returns to the accumulator-driven fixed-step loop. The displayed tick is therefore engine time, not an estimate derived from animation frames.

`runtimeMetrics.ts` summarizes a bounded browser sample window. The renderer loop measures elapsed wall time, rendered frames, Rapier tick delta, and Three.js renderer counters, then publishes one `RuntimeMetrics` value after at least 500 ms. `frameMs` and `fps` describe presentation cadence; `physicsHz` describes engine ticks per second; draw calls, triangles, geometries, textures, object count, and pixel ratio describe the observed local scene budget. The panel intentionally labels these as local measurements rather than a device-independent benchmark.

`replay.ts` keeps the replay layer on the existing `rulebreaker/experiment/v1` snapshot contract. The first checkpoint is tick 0; later checkpoints are captured every 30 simulation ticks and bounded to 48 entries. Restoring a checkpoint calls the same validated `simulation.restore` path used by import and branch restore, then pauses the room. Browsing preserves all retained checkpoints. Only resuming, stepping, or changing a law commits the historical branch and removes its abandoned future. Browsing clears the old Undo chain, while the explicit saved branch remains a separate bookmark. Periodic checkpoints are captured inside each physics step so a render frame spanning several ticks cannot skip an interval boundary. Replay does not make provider requests.

Replacement collision-note policies and explicit silence clear the previous policy's cooldown map.

The sample scene keeps its dynamic bodies awake so gravity changes can affect objects after they settle against a boundary. Sleeping-body optimization and cross-browser determinism remain outside this slice.

## Experiment format and history

`rulebreaker/experiment/v1` records the scene identity, `rulebreaker/engine/v1`, simulation tick, every body's transform/velocity/gravity scale, freeze expiry, the active collision-note law, pending events, cooldown map, note sequence, and the selected object. `simulation.restore` validates the whole document and all references before changing a body. Undo and branch restore use the same restore path, so they do not call a model. Pending events stored in a historical snapshot remain inspectable immediately after restore, but are consumed without re-emission so historical sounds do not play twice. The UI keeps a bounded local history of 24 snapshots and one branch point. Export/import is local JSON; it is not a cloud save or a cross-browser determinism claim.

## Live AI seam

`server/ai.ts` sends a bounded prompt plus the validated scene to an OpenAI-compatible `/chat/completions` endpoint using `RULEBREAKER_AI_BASE_URL`, `RULEBREAKER_AI_API_KEY`, and `RULEBREAKER_AI_MODEL`. The system prompt requires a JSON envelope containing a short interpretation and one typed law; `validateLaw` checks scope and bounds before the proposal reaches the UI. Requests time out after eight seconds and accept cancellation. A missing key or malformed/provider-failed response is shown as a live-mode error while prepared mode continues unchanged. The adapter is mounted by the local Vite middleware; no browser bundle contains the key, and no production deployment is implied.

## Scope

The project does not implement the complete docs/BUILD-PROMPT.md. docs/NEXT-STEPS.md lists the remaining proof work. A local dev server is not a public deployment, and a configured adapter is not live-provider proof until a real request produces an applied engine effect.

## Presentation and resource lifetime

The room is lazy-loaded behind a recoverable loading/error boundary. A fixed 60 Hz simulation advances independently of render rate; hidden tabs do not accumulate physics work. UI clock publication is sampled rather than rendering the entire React tree every physics tick. The guided route advances on engine ticks, and reduced-motion visitors start paused.

Reset/navigation dispose every scene geometry and material (including grids/selection halos), camera listeners, resize observation, the renderer, and the Rapier world. App teardown aborts provider work and closes Web Audio. Reset stops active notes and invalidates in-flight requests; stale provider responses cannot replace a newer prepared proposal.
