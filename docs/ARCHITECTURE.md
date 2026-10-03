# Rulebreaker architecture

A single Vite/React/TypeScript application with independent npm dependencies and a lockfile. Zod validates the versioned scene and law formats. The prepared slice has no application server, account system, credential, or provider request.

`src/domain.ts` owns scene/law validation. `src/simulation.ts` owns the Rapier instance and fixed-step state. `src/World.tsx` owns rendering, camera controls, raycast selection, and the animation loop. `src/App.tsx` owns the prepared interaction panel and browser audio activation. `src/scene.json` is the sample scene.

## Law format

Every law carries `schema: rulebreaker/law/v1`, an explicit `operation`, and a bounded list of object IDs. The current operations are:

- `set-gravity-scale`: apply a finite scale from −2 to 2 to selected bodies.
- `collision-note`: observe selected bodies at a finite impact threshold, with an integer cooldown and voice limit.
- `temporary-freeze`: lock selected bodies for a bounded number of simulation ticks, then restore dynamic translation, rotation, and zero velocity.

`validateLaw` parses the complete discriminated union and checks every target against the scene before `simulation.apply` mutates the world. A mixed valid/invalid selection therefore leaves the previous state unchanged. Gravity and collision-note laws compose; a later gravity law changes the selected body's scale while a temporary freeze only locks motion until its expiry.

## Simulation events

Rapier advances at a fixed 1/60-second step. Collision events are collected through `EventQueue`, filtered by target and relative impact speed, and emitted as bounded `collision-note` events with a deterministic rotating frequency. A pair cooldown prevents persistent contacts from becoming an unbounded event stream. Freeze expiry is measured in the same simulation ticks, so the timer remains independent of render-frame pacing. The browser presentation consumes these events and schedules short Web Audio voices only after an explicit user gesture.

The sample scene keeps its dynamic bodies awake so gravity changes can affect objects after they settle against a boundary. Sleeping-body optimization and complete replay semantics belong to the next experiment slice.

## Future AI seam

Add a thin server-side adapter behind a tested request/response format when beginning the AI slice. The product engine owns effects and state; a model proposes bounded data. Timeouts, unsupported output, and cancellation must preserve the current prepared experience. Credentials must not become VITE_ variables or committed artifacts.

## Scope

This slice does not implement the complete docs/BUILD-PROMPT.md. docs/NEXT-STEPS.md lists the remaining work. A local dev server is not a public deployment.
