# Rulebreaker

A physics playground where you can change the rules, inspect the consequences, and rewind to try another path.

[Source](https://github.com/jonah-ux/rulebreaker) · [Architecture](docs/ARCHITECTURE.md) · [Release procedure](docs/RELEASE.md)

## Play the Impossible Room

Your first mission: get both blue shapes to the ceiling. Apply **Blue objects fall upward** and watch the physics engine move them. Red and gold keep falling.

- **Listen** turns meaningful impacts into short notes. Enable audio once, and use **Mute audio** whenever you want quiet.
- **Freeze** holds a selected shape for three seconds of simulation time. Its gravity and other laws remain intact.
- **Pause room** stops the physics clock. **Step 1 tick** advances one fixed 1/60-second step while paused.
- **Previous**, **Next**, **Latest**, and the replay slider let you browse recorded physics states. Browsing preserves the future; resuming or applying a law creates a new branch.

Drag to orbit, scroll to zoom, and click a shape to select it. The object list also supports keyboard selection. Reduced-motion visitors start with a paused room and can explicitly resume it.

Use the prepared composer for “make the blue shapes rise”, “turn impacts into little tones”, or “hold this object still”. It interprets supported phrases locally, shows the affected shapes, and waits for **Apply proposal**. Ambiguous, negated, or unsupported instructions are refused. Compose multiple laws by applying them one at a time.

**Run Impossible Room demo** takes you through the three laws using the simulation clock. Pausing pauses the demonstration too.

## Keep an experiment

Open **Experiment tools & diagnostics** to undo a law, save a branch, export/download JSON, or load a saved file. Import is validated before any body changes. A restored experiment pauses so you can inspect it before continuing.

Snapshots use `rulebreaker/experiment/v1` and preserve body identities, positions, rotations, velocities, gravity, freeze timers, collision policy/cooldowns, and selection. Replay checkpoints use the same format and keep up to 48 recorded states. Timeline browsing clears the old Undo chain; the explicit saved branch remains a separate bookmark. Historical pending events are consumed without duplicate audio playback.

Prepared play makes no model requests. Experiments remain in the current browser unless you deliberately download or share the JSON. There is no account, cloud save, or tracking SDK.

## Run locally

Use Node.js 22.x (22.12 or newer) and npm:

```sh
npm ci
npm run dev
```

Open [localhost:5173](http://127.0.0.1:5173). Build the static application with `npm run build` and inspect it with `npm run preview`.

## Verification

```sh
npm run verify
```

The gate runs lint, TypeScript, engine/schema/interpreter/replay tests, and a production build. Browser acceptance is a separate release gate; a build is insufficient evidence for physics controls, audio, or deployment. See the [release procedure](docs/RELEASE.md) for the browser and hosting commands.

## Optional live AI

Live AI is an optional server feature. Prepared interpretation is always the no-key path. Production live requests must remain disabled unless the deployment has an authorized operator access policy; a provider key alone is insufficient.

The server adapter converts a bounded prompt and scene into a supported typed law. It never executes model-generated code. The client validates the law again and waits for explicit approval. Secrets belong in the server environment, never in browser variables, JSON experiments, or source. Provider setup and actual provider request → validated law → engine effect are separate acceptance work; this project does not claim them from fixtures.

## Supported limits

- The shipped room contains four rigid bodies, a floor, and a ceiling. The validated schema supports at most 24 bodies.
- Replay records snapshots, not a complete input log or every internal Rapier contact/solver state. Checkpoint inspection is supported; bit-for-bit future trajectories across browsers or engine versions are not promised.
- Undo keeps 24 states, replay keeps 48 checkpoints, event history keeps 16 entries, pending engine events are capped at 64, and audio voices follow the approved bounded policy.
- The runtime inspector reports local frame intervals, physics step counts, renderer counters, and pixel ratio. These are observations of your browser and machine, not benchmark guarantees.
- The heavy Three.js/Rapier module loads separately from the interface. A large physics chunk remains; mobile/GPU capability affects startup and rendering.

## Development and provenance

Start with [AGENTS.md](AGENTS.md), [NEXT-STEPS.md](docs/NEXT-STEPS.md), and the [build contract](docs/BUILD-PROMPT.md). Keep source, review, merge, deployment, runtime adoption, and live-provider proof distinct.

Built with React, Vite, Three.js, Rapier, Zod, and public dependencies in the lockfile. The sample room and prepared laws were authored with AI assistance. [Genie](https://deepmind.google/models/genie/) is related generative-world work; Rulebreaker focuses on inspectable typed laws and persistent physics consequences. [MIT license](LICENSE).
