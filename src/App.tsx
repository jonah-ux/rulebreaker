import { useCallback, useEffect, useRef, useState } from 'react'
import sample from './scene.json'
import { World } from './World'
import type { RuntimeMetrics } from './runtimeMetrics'
import type { Experiment, Law } from './domain'
import { PreparedInterpreterError, interpretPreparedPrompt } from './preparedInterpreter'
import type { SimulationEvent } from './simulation'
import './App.css'

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext }
type LiveProposal = { mode: 'prepared' | 'live-ai'; provider?: string; model: string; interpretation: string; law: Law }
type LedgerTone = 'law' | 'impact' | 'freeze' | 'restore'
type LedgerEntry = { id: number; tone: LedgerTone; title: string; detail: string }

const objectNames: Record<string, string> = {
  'blue-a': 'Blue prism A',
  'blue-b': 'Blue prism B',
  'red-a': 'Red prism',
  'gold-a': 'Gold prism',
}

function displayName(id: string) {
  return objectNames[id] ?? id
}

export default function App() {
  const [upward, setUpward] = useState(false)
  const [collisionNotes, setCollisionNotes] = useState(false)
  const [freezeOnClick, setFreezeOnClick] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [freezeRequest, setFreezeRequest] = useState<{ id: string; nonce: number } | null>(null)
  const [reset, setReset] = useState(0)
  const [height, setHeight] = useState(4)
  const [lastNote, setLastNote] = useState<Extract<SimulationEvent, { type: 'collision-note' }> | null>(null)
  const [frozen, setFrozen] = useState<Record<string, number>>({})
  const [audioEnabled, setAudioEnabled] = useState(false)
  const [historyAction, setHistoryAction] = useState<{ type: 'undo' | 'save-branch' | 'restore-branch'; nonce: number } | null>(null)
  const [exportRequest, setExportRequest] = useState<{ nonce: number } | null>(null)
  const [importRequest, setImportRequest] = useState<{ nonce: number; payload: string } | null>(null)
  const [lawRequest, setLawRequest] = useState<{ nonce: number; law: unknown } | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [hasBranch, setHasBranch] = useState(false)
  const [experimentText, setExperimentText] = useState('')
  const [experimentStatus, setExperimentStatus] = useState('Snapshots include laws, timers, physics state, cooldowns, and selection.')
  const [livePrompt, setLivePrompt] = useState('')
  const [liveProposal, setLiveProposal] = useState<LiveProposal | null>(null)
  const [liveStatus, setLiveStatus] = useState('Live AI is separate from prepared mode and requires server configuration.')
  const [liveBusy, setLiveBusy] = useState(false)
  const [demoStep, setDemoStep] = useState(0)
  const [demoRunning, setDemoRunning] = useState(false)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [paused, setPaused] = useState(false)
  const [stepRequest, setStepRequest] = useState<{ nonce: number } | null>(null)
  const [simulationTick, setSimulationTick] = useState(0)
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetrics | null>(null)
  const audioContext = useRef<AudioContext | null>(null)
  const activeVoices = useRef(0)
  const actionNonce = useRef(0)
  const liveAbort = useRef<AbortController | null>(null)
  const demoTimers = useRef<number[]>([])
  const ledgerId = useRef(0)

  useEffect(() => () => { for (const timer of demoTimers.current) window.clearTimeout(timer) }, [])

  const enableAudio = () => {
    const AudioContextClass = window.AudioContext ?? (window as AudioWindow).webkitAudioContext
    if (!AudioContextClass) return
    const context = audioContext.current ?? new AudioContextClass()
    audioContext.current = context
    void context.resume()
    setAudioEnabled(true)
  }

  const playNote = useCallback((frequency: number) => {
    const context = audioContext.current
    if (!audioEnabled || !context || activeVoices.current >= 4) return
    activeVoices.current += 1
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.14)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.15)
    oscillator.addEventListener('ended', () => { activeVoices.current = Math.max(0, activeVoices.current - 1) }, { once: true })
  }, [audioEnabled])

  const addLedgerEntry = useCallback((tone: LedgerTone, title: string, detail: string) => {
    ledgerId.current += 1
    setLedger(current => [{ id: ledgerId.current, tone, title, detail }, ...current].slice(0, 16))
  }, [])

  const handleEvent = useCallback((event: SimulationEvent) => {
    if (event.type === 'collision-note') {
      setLastNote(event)
      playNote(event.frequency)
      addLedgerEntry('impact', `Impact note · ${displayName(event.first)}`, `${event.impact.toFixed(1)} m/s · ${event.frequency} Hz · tick ${event.tick}`)
    } else if (event.type === 'freeze-applied') {
      setFrozen(current => ({ ...current, [event.target]: event.expiresAtTick }))
      addLedgerEntry('freeze', `Freeze engaged · ${displayName(event.target)}`, `expires at simulation tick ${event.expiresAtTick}`)
    } else {
      setFrozen(current => {
        const next = { ...current }
        delete next[event.target]
        return next
      })
      addLedgerEntry('freeze', `Freeze expired · ${displayName(event.target)}`, 'dynamic motion restored')
    }
  }, [addLedgerEntry, playNote])

  const selectObject = useCallback((id: string) => setSelectedId(id), [])
  const nextNonce = () => { actionNonce.current += 1; return actionNonce.current }
  const runHistoryAction = (type: 'undo' | 'save-branch' | 'restore-branch') => {
    setHistoryAction({ type, nonce: nextNonce() })
    addLedgerEntry('restore', `Timeline action · ${type.replace('-', ' ')}`, 'engine snapshot path requested')
  }
  const handleHistoryState = useCallback((undo: boolean, branch: boolean) => {
    setCanUndo(undo)
    setHasBranch(branch)
  }, [])
  const handleExport = useCallback((payload: string) => {
    setExperimentText(payload)
    setExperimentStatus('Export ready. Reset the room, then import this snapshot to continue the experiment.')
    addLedgerEntry('restore', 'Experiment exported', 'rulebreaker/experiment/v1 snapshot ready')
  }, [addLedgerEntry])
  const handleImportResult = useCallback((result: { ok: boolean; message: string }) => {
    setExperimentStatus(result.message)
    addLedgerEntry('restore', result.ok ? 'Experiment imported' : 'Experiment import refused', result.message)
  }, [addLedgerEntry])
  const handleLawResult = useCallback((result: { ok: boolean; message: string }) => {
    setLiveStatus(result.message)
    if (result.ok) addLedgerEntry('law', 'Law applied to the engine', result.message)
  }, [addLedgerEntry])
  const handleRestored = useCallback((snapshot: Experiment) => {
    const blueBodies = snapshot.bodies.filter(body => body.id.startsWith('blue-'))
    setUpward(blueBodies.length > 0 && blueBodies.every(body => body.gravityScale === -1))
    setCollisionNotes(snapshot.collisionNoteLaw !== null)
    setSelectedId(snapshot.selectedId)
    setFreezeRequest(null)
    setHeight(snapshot.bodies.find(body => body.id === 'blue-a')?.position[1] ?? 0.5)
    const activeFrozen: Record<string, number> = {}
    for (const body of snapshot.bodies) if (body.frozenUntilTick !== null && body.frozenUntilTick > snapshot.tick) activeFrozen[body.id] = body.frozenUntilTick
    setFrozen(activeFrozen)
    setLastNote(null)
    setSimulationTick(snapshot.tick)
    addLedgerEntry('restore', 'Snapshot restored', `tick ${snapshot.tick} · ${snapshot.bodies.length} bodies`)
  }, [addLedgerEntry])
  const requestFreeze = () => {
    if (!selectedId) return
    setFreezeRequest({ id: selectedId, nonce: Date.now() })
    addLedgerEntry('freeze', `Freeze requested · ${displayName(selectedId)}`, '180 simulation ticks')
  }
  const toggleGravity = () => {
    const next = !upward
    setUpward(next)
    addLedgerEntry('law', next ? 'Prepared law applied · inverted gravity' : 'Prepared law restored · ordinary gravity', 'scope: blue objects')
  }
  const toggleCollisionNotes = () => {
    const next = !collisionNotes
    setCollisionNotes(next)
    addLedgerEntry('law', next ? 'Prepared law applied · collision notes' : 'Prepared law silenced', next ? 'threshold 1.2 m/s · cooldown 24 ticks · four voices' : 'collision-note policy removed')
  }
  const togglePaused = () => {
    const next = !paused
    setPaused(next)
    addLedgerEntry('restore', next ? 'Simulation paused' : 'Simulation resumed', `clock tick ${simulationTick}`)
  }
  const stepSimulation = () => {
    if (!paused) return
    setStepRequest({ nonce: nextNonce() })
    addLedgerEntry('restore', 'Simulation advanced one tick', `from tick ${simulationTick}`)
  }
  const resetRoom = () => {
    for (const timer of demoTimers.current) window.clearTimeout(timer)
    demoTimers.current = []
    setDemoRunning(false)
    setDemoStep(0)
    setUpward(false)
    setCollisionNotes(false)
    setFreezeOnClick(false)
    setSelectedId(null)
    setFreezeRequest(null)
    setFrozen({})
    setLastNote(null)
    setHistoryAction(null)
    setExportRequest(null)
    setImportRequest(null)
    setLawRequest(null)
    setLiveProposal(null)
    setLiveStatus('Live AI is separate from prepared mode and requires server configuration.')
    setCanUndo(false)
    setHasBranch(false)
    setPaused(false)
    setStepRequest(null)
    setSimulationTick(0)
    setRuntimeMetrics(null)
    setExperimentStatus('Room reset. Import an experiment snapshot here to restore it.')
    setLedger([])
    setReset(value => value + 1)
  }

  const requestExport = () => setExportRequest({ nonce: nextNonce() })
  const requestImport = () => setImportRequest({ nonce: nextNonce(), payload: experimentText })
  const runGuidedDemo = () => {
    for (const timer of demoTimers.current) window.clearTimeout(timer)
    demoTimers.current = []
    resetRoom()
    setDemoRunning(true)
    setDemoStep(1)
    demoTimers.current.push(window.setTimeout(() => {
      setCollisionNotes(true)
      addLedgerEntry('law', 'Guided step · collision notes', 'prepared collision-note policy active')
      setDemoStep(1)
    }, 350))
    demoTimers.current.push(window.setTimeout(() => {
      setUpward(true)
      addLedgerEntry('law', 'Guided step · inverted gravity', 'blue prisms now rise')
      setDemoStep(2)
    }, 1500))
    demoTimers.current.push(window.setTimeout(() => {
      setSelectedId('blue-a')
      setFreezeRequest({ id: 'blue-a', nonce: nextNonce() })
      addLedgerEntry('freeze', 'Guided step · freeze Blue prism A', 'three-second simulation timer')
      setDemoStep(3)
    }, 2900))
    demoTimers.current.push(window.setTimeout(() => {
      setDemoRunning(false)
      setDemoStep(4)
    }, 5200))
  }
  const requestPreparedProposal = () => {
    try {
      const proposal = interpretPreparedPrompt(livePrompt, sample, selectedId)
      setLiveProposal({ ...proposal, model: 'prepared rules' })
      setLiveStatus('Prepared interpretation ready. Review it before applying; no provider request was made.')
    } catch (error) {
      setLiveProposal(null)
      setLiveStatus(error instanceof PreparedInterpreterError ? error.message : 'Prepared interpretation failed.')
    }
  }
  const requestLiveProposal = async () => {
    if (!livePrompt.trim()) {
      setLiveStatus('Describe a law before asking the live interpreter.')
      return
    }
    liveAbort.current?.abort()
    const controller = new AbortController()
    liveAbort.current = controller
    setLiveBusy(true)
    setLiveStatus('Asking the configured provider to propose a typed law…')
    try {
      const response = await fetch('/api/interpret', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: livePrompt, scene: sample }),
        signal: controller.signal,
      })
      const payload = await response.json() as { error?: string } & Partial<LiveProposal>
      if (!response.ok) throw new Error(payload.error ?? `Live interpreter returned HTTP ${response.status}`)
      if (payload.mode !== 'live-ai' || !payload.law || typeof payload.interpretation !== 'string') throw new Error('Live interpreter returned an incomplete proposal.')
      const proposal = payload as LiveProposal
      setLiveProposal(proposal)
      setLiveStatus(`Validated ${proposal.law.operation} from ${proposal.model}. Review it before applying.`)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setLiveProposal(null)
      setLiveStatus(error instanceof Error ? error.message : 'Live interpretation failed.')
    } finally {
      if (liveAbort.current === controller) liveAbort.current = null
      setLiveBusy(false)
    }
  }
  const applyLiveProposal = () => {
    if (!liveProposal) return
    const law = liveProposal.law
    setLawRequest({ nonce: nextNonce(), law })
    setSelectedId(law.targets[0] ?? null)
    if (law.operation === 'set-gravity-scale') setUpward(law.scale < 0)
    if (law.operation === 'collision-note') setCollisionNotes(true)
    setLiveStatus(liveProposal.mode === 'prepared' ? 'Applying the prepared interpretation…' : 'Applying the validated live proposal…')
    addLedgerEntry('law', liveProposal.mode === 'prepared' ? 'Prepared interpretation applied' : 'Live proposal approved', liveProposal.interpretation)
  }

  const selectedName = selectedId ? displayName(selectedId) : 'Nothing selected'
  const frozenNames = Object.keys(frozen).map(displayName)

  return <main>
    <header className="hero">
      <div>
        <span className="eyebrow">RULEBREAKER / IMPOSSIBLE ROOM</span>
        <h1>Change a law. Watch the room argue back.</h1>
        <p className="lede">A tiny physics laboratory for inspectable, composable rules. Pick a shape, try a prepared law, then undo the experiment and write a stranger one.</p>
      </div>
      <div className="mode-card" aria-label="Runtime mode">
        <span className="mode-dot" aria-hidden="true" />
        <div><strong>Prepared mode</strong><span>No key required · live AI is not connected</span></div>
      </div>
    </header>

    <section className="panel live-panel" aria-label="Live AI interpreter">
      <div className="panel-heading"><div><span className="panel-kicker">LIVE / PROVIDER</span><h2>Ask the configured interpreter</h2></div><span className="live-badge">separate path</span></div>
      <p className="panel-copy">Describe a law in plain language. The local prepared interpreter works without a key; the optional server path can ask a configured provider. Every proposal is validated and waits for your approval.</p>
      <div className="live-form"><input aria-label="Law prompt" value={livePrompt} onChange={event => setLivePrompt(event.target.value)} placeholder="e.g. make the blue shapes rise" maxLength={500} /><button className="small-button" onClick={requestPreparedProposal}>Try prepared</button><button className="small-button" disabled={liveBusy} onClick={requestLiveProposal}>{liveBusy ? 'Thinking…' : 'Ask live AI'}</button></div>
      <div className="live-status">{liveStatus}</div>
      {liveProposal && <div className="proposal-card"><div><span className="panel-kicker">{liveProposal.mode === 'prepared' ? 'PREPARED INTERPRETATION' : 'VALIDATED LIVE PROPOSAL'}</span><strong>{liveProposal.interpretation}</strong><span>{liveProposal.model} · {liveProposal.law.operation}</span></div><button className="freeze-button" onClick={applyLiveProposal}>Apply proposal</button></div>}
    </section>

    <section className="panel demo-panel" aria-label="Impossible Room guided demo">
      <div className="panel-heading"><div><span className="panel-kicker">GUIDED / IMPOSSIBLE ROOM</span><h2>See the three laws compose</h2></div><span className="law-count">{demoStep === 4 ? 'complete' : '3 steps'}</span></div>
      <p className="panel-copy">Run the no-key route once: listen for impact events, invert blue gravity, then freeze a selected body. When it ends, invent a variation with the prepared controls.</p>
      <div className="demo-actions"><button className="freeze-button" disabled={demoRunning} onClick={runGuidedDemo}>{demoRunning ? 'Demo running…' : 'Run Impossible Room demo'}</button><span aria-live="polite">{demoStep === 0 ? 'Ready when you are.' : demoStep === 1 ? 'Step 1 · collision-note law is active.' : demoStep === 2 ? 'Step 2 · blue prisms are rising.' : demoStep === 3 ? 'Step 3 · Blue prism A is frozen for three seconds.' : 'Demo complete · now write a stranger law.'}</span></div>
      <ol className="demo-steps"><li className={demoStep >= 1 ? 'is-done' : ''}>Listen to meaningful collisions</li><li className={demoStep >= 2 ? 'is-done' : ''}>Invert blue gravity</li><li className={demoStep >= 3 ? 'is-done' : ''}>Freeze the selected body</li></ol>
    </section>

    <section className="stage" aria-label="Impossible Room">
      <World
        key={reset}
        upward={upward}
        collisionNotes={collisionNotes}
        freezeOnClick={freezeOnClick}
        freezeRequest={freezeRequest}
        selectedId={selectedId}
        historyAction={historyAction}
        exportRequest={exportRequest}
        importRequest={importRequest}
        lawRequest={lawRequest}
        onHeight={setHeight}
        onSelected={selectObject}
        onEvent={handleEvent}
        onHistoryState={handleHistoryState}
        onExport={handleExport}
        onImportResult={handleImportResult}
        onLawResult={handleLawResult}
        onRestored={handleRestored}
        paused={paused}
        stepRequest={stepRequest}
        onTick={setSimulationTick}
        onMetrics={setRuntimeMetrics}
      />
      <div className="stage-caption"><span>DRAG TO ORBIT</span><span>SCROLL TO ZOOM</span><span>CLICK TO SELECT</span></div>
      <div className="stage-controls" aria-label="Simulation controls"><button className="stage-control-button" onClick={togglePaused}>{paused ? 'Resume room' : 'Pause room'}</button><button className="stage-control-button" disabled={!paused} onClick={stepSimulation}>Step 1 tick</button><span className={paused ? 'clock-state paused' : 'clock-state'}>{paused ? 'PAUSED' : 'LIVE'} · TICK {simulationTick}</span></div>
    </section>

    <section className="lab-grid">
      <div className="panel laws-panel">
        <div className="panel-heading"><div><span className="panel-kicker">01 / LAWS</span><h2>Rewrite the room</h2></div><div className="heading-actions"><span className="law-count">{[upward, collisionNotes, Object.keys(frozen).length > 0].filter(Boolean).length} active</span><button className="reset-button" onClick={resetRoom}>Reset</button></div></div>
        <p className="panel-copy">Every prepared law is typed, scoped, and applied atomically by the physics engine.</p>

        <article className={`law-card ${upward ? 'is-active' : ''}`}>
          <div className="law-index gravity-index">A</div>
          <div className="law-body"><h3>Blue objects fall upward</h3><p>Blue prisms use gravity scale −1. Red and gold keep ordinary gravity.</p><div className="law-meta"><span>{upward ? 'ACTIVE' : 'READY'}</span><span>scope: blue</span></div></div>
          <button className="small-button" onClick={toggleGravity}>{upward ? 'Restore' : 'Apply'}</button>
        </article>

        <article className={`law-card ${collisionNotes ? 'is-active' : ''}`}>
          <div className="law-index note-index">B</div>
          <div className="law-body"><h3>Every collision plays a note</h3><p>Impacts above 1.2 m/s trigger a short tone, with a 24-tick pair cooldown and four-voice cap.</p><div className="law-meta"><span>{collisionNotes ? 'ACTIVE' : 'READY'}</span><span>scope: all objects</span></div></div>
          <button className="small-button" onClick={toggleCollisionNotes}>{collisionNotes ? 'Silence' : 'Listen'}</button>
        </article>

        <article className={`law-card ${freezeOnClick ? 'is-active' : ''}`}>
          <div className="law-index freeze-index">C</div>
          <div className="law-body"><h3>Click to freeze for three seconds</h3><p>Freeze mode locks the selected body for 180 simulation ticks, then restores dynamic motion.</p><div className="law-meta"><span>{freezeOnClick ? 'CLICK MODE' : 'READY'}</span><span>scope: selected</span></div></div>
          <button className="small-button" onClick={() => setFreezeOnClick(current => !current)}>{freezeOnClick ? 'Exit mode' : 'Enter mode'}</button>
        </article>

        <div className="audio-row"><div><strong>Sound activation</strong><span>{audioEnabled ? 'AudioContext ready for collision notes.' : 'Browsers require one explicit gesture before sound.'}</span></div><button className="secondary-button" onClick={enableAudio} disabled={audioEnabled}>{audioEnabled ? 'Enabled' : 'Enable audio'}</button></div>
      </div>

      <aside className="panel inspector-panel">
        <div className="panel-heading"><div><span className="panel-kicker">02 / INSPECTOR</span><h2>Inspect a body</h2></div><span className="selection-pip" aria-hidden="true" /></div>
        <p className="panel-copy">Selection is shared by the canvas and the keyboard-friendly list.</p>
        <div className="object-list" aria-label="Room objects">
          {sample.objects.map(object => <button key={object.id} className={`object-button ${selectedId === object.id ? 'is-selected' : ''}`} onClick={() => selectObject(object.id)} aria-pressed={selectedId === object.id}><span className={`object-swatch ${object.color}`} /><span><strong>{displayName(object.id)}</strong><small>{object.color} · {frozen[object.id] ? 'frozen' : 'dynamic'}</small></span><span className="chevron">{selectedId === object.id ? '●' : '○'}</span></button>)}
        </div>
        <div className="selection-readout"><span>Selected</span><strong>{selectedName}</strong></div>
        <button className="freeze-button" disabled={!selectedId} onClick={requestFreeze}>Freeze {selectedId ? displayName(selectedId) : 'selected body'} for 3 seconds</button>
        {frozenNames.length > 0 && <div className="frozen-strip"><span className="pulse" />Frozen now: {frozenNames.join(', ')}</div>}
      </aside>
    </section>

    <section className="panel experiment-panel" aria-label="Experiment history and import">
      <div className="panel-heading"><div><span className="panel-kicker">03 / EXPERIMENT</span><h2>Undo, branch, and carry the room</h2></div><span className="law-count">{canUndo ? 'undo ready' : 'new timeline'}</span></div>
      <p className="panel-copy">Snapshots use <code>rulebreaker/experiment/v1</code>. They restore physics state, active laws, freeze timers, collision cooldowns, and the selected body without another model request.</p>
      <div className="experiment-actions">
        <button className="secondary-button" disabled={!canUndo} onClick={() => runHistoryAction('undo')}>Undo last law</button>
        <button className="secondary-button" onClick={() => runHistoryAction('save-branch')}>Save branch</button>
        <button className="secondary-button" disabled={!hasBranch} onClick={() => runHistoryAction('restore-branch')}>Restore branch</button>
        <button className="secondary-button" onClick={requestExport}>Export JSON</button>
      </div>
      <textarea aria-label="Experiment JSON" value={experimentText} onChange={event => setExperimentText(event.target.value)} placeholder="Export a snapshot or paste a rulebreaker/experiment/v1 document here." rows={5} />
      <div className="import-row"><button className="freeze-button" disabled={!experimentText.trim()} onClick={requestImport}>Import into room</button><span>{experimentStatus}</span></div>
    </section>

    <section className="panel ledger-panel" aria-label="Recent room events">
      <div className="panel-heading"><div><span className="panel-kicker">04 / EVENT LEDGER</span><h2>Watch the consequences accumulate</h2></div><span className="law-count">{ledger.length} recent</span></div>
      <p className="panel-copy">The ledger records engine events and timeline actions so an experiment stays inspectable after the motion settles.</p>
      {ledger.length === 0 ? <div className="ledger-empty">No events yet. Apply a law or run the guided room.</div> : <ol className="ledger-list">{ledger.slice(0, 8).map(entry => <li key={entry.id} className={`ledger-entry ${entry.tone}`}><span className="ledger-mark" /><div><strong>{entry.title}</strong><span>{entry.detail}</span></div></li>)}</ol>}
    </section>

    <section className="telemetry-row" aria-label="Live room telemetry">
      <div><span className="telemetry-label">BLUE HEIGHT</span><strong>{height.toFixed(2)} <small>m</small></strong><span>{upward ? 'rising under inverted gravity' : 'moving under ordinary gravity'}</span></div>
      <div><span className="telemetry-label">LAST IMPACT</span><strong>{lastNote ? `${lastNote.impact.toFixed(1)} m/s` : 'waiting'}</strong><span>{lastNote ? `${displayName(lastNote.first)} → ${lastNote.second === 'room' ? 'room boundary' : displayName(lastNote.second)}` : 'turn on collision notes to listen'}</span></div>
      <div><span className="telemetry-label">UNDO / BRANCH</span><strong>{canUndo ? 'Ready' : 'Waiting'}</strong><span>{hasBranch ? 'One branch is saved locally.' : 'Save a branch before trying a new path.'}</span></div>
    </section>

    <section className="panel runtime-panel" aria-label="Runtime telemetry">
      <div className="panel-heading"><div><span className="panel-kicker">05 / RUNTIME</span><h2>Measure the room</h2></div><span className="law-count">{runtimeMetrics ? 'live sample' : 'warming up'}</span></div>
      <p className="panel-copy">Measured from the browser’s render loop over the latest half-second window. Physics cadence is Rapier ticks per second; resource counts are renderer-reported scene totals.</p>
      <div className="runtime-grid">
        <div><span className="telemetry-label">FRAME TIME</span><strong>{runtimeMetrics ? <>{runtimeMetrics.frameMs.toFixed(1)} <small>ms</small></> : '—'}</strong><span>{runtimeMetrics ? `${runtimeMetrics.fps.toFixed(1)} measured FPS` : 'Collecting a sample…'}</span></div>
        <div><span className="telemetry-label">PHYSICS CADENCE</span><strong>{runtimeMetrics ? <>{runtimeMetrics.physicsHz.toFixed(1)} <small>Hz</small></> : '—'}</strong><span>{runtimeMetrics ? `${runtimeMetrics.tickDelta} ticks in ${Math.round(runtimeMetrics.sampleWindowMs)} ms` : 'Waiting for fixed-step samples'}</span></div>
        <div><span className="telemetry-label">RENDER WORK</span><strong>{runtimeMetrics ? <>{runtimeMetrics.drawCalls} <small>calls</small></> : '—'}</strong><span>{runtimeMetrics ? `${runtimeMetrics.triangles} triangles per frame` : 'Renderer counters unavailable'}</span></div>
        <div><span className="telemetry-label">SCENE RESOURCES</span><strong>{runtimeMetrics ? <>{runtimeMetrics.objectCount} <small>bodies</small></> : '—'}</strong><span>{runtimeMetrics ? `${runtimeMetrics.geometries} geometries · ${runtimeMetrics.textures} textures · DPR ${runtimeMetrics.pixelRatio.toFixed(1)}` : 'Collecting renderer totals'}</span></div>
      </div>
    </section>

    <footer><span>Prepared behavior is intentionally labeled.</span><span>Next: live model proposals and replay proof.</span><a href="https://github.com/jonah-ux/rulebreaker" target="_blank" rel="noreferrer">View source ↗</a></footer>
  </main>
}
