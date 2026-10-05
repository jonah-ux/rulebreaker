import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import sample from './scene.json'
const World = lazy(() => import('./World').then(module => ({ default: module.World })))
import type { RuntimeMetrics } from './runtimeMetrics'
import { RoomBoundary } from './RoomBoundary'
import { branchReplay, checkpointAtIndex, upsertReplayCheckpoint } from './replay'
import type { ReplayCheckpoint } from './replay'
import { SceneSchema, validateLaw } from './domain'
import type { Experiment, Law } from './domain'
import { PreparedInterpreterError, interpretPreparedPrompt } from './preparedInterpreter'
import type { SimulationEvent } from './simulation'
import { createExperimentShareUrl, decodeExperimentShare, hasExperimentShare } from './share'
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

const DEFAULT_SHARE_STATUS = 'Create a link to this exact room state. It stays local and needs no account.'

function readInitialShare() {
  if (!hasExperimentShare(window.location.hash)) return { value: null, url: '', status: DEFAULT_SHARE_STATUS }
  const value = decodeExperimentShare(window.location.hash)
  return value === null
    ? { value: null, url: '', status: 'This share link is malformed or incomplete. The room stayed unchanged.' }
    : { value, url: window.location.href, status: 'Shared experiment found. The room will validate it before restoring anything.' }
}

function displayName(id: string) {
  return objectNames[id] ?? id
}

const validatedScene = SceneSchema.parse(sample)

export default function App() {
  const [upward, setUpward] = useState(false)
  const [gravityScales, setGravityScales] = useState<Record<string, number>>(() => Object.fromEntries(sample.objects.map(object => [object.id, 1])))
  const [collisionPolicy, setCollisionPolicy] = useState<Experiment['collisionNoteLaw']>(null)
  const [collisionNotes, setCollisionNotes] = useState(false)
  const [freezeOnClick, setFreezeOnClick] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [freezeRequest, setFreezeRequest] = useState<{ id: string; nonce: number } | null>(null)
  const [reset, setReset] = useState(0)
  const [height, setHeight] = useState(4)
  const [lastNote, setLastNote] = useState<Extract<SimulationEvent, { type: 'collision-note' }> | null>(null)
  const [frozen, setFrozen] = useState<Record<string, number>>({})
  const [audioEnabled, setAudioEnabled] = useState(false)
  const [audioStatus, setAudioStatus] = useState('Sound is off. Enable it to hear impacts.')
  const [worldReady, setWorldReady] = useState(false)
  const [goalProgress, setGoalProgress] = useState(0)
  const [historyAction, setHistoryAction] = useState<{ type: 'undo' | 'save-branch' | 'restore-branch'; nonce: number } | null>(null)
  const [exportRequest, setExportRequest] = useState<{ nonce: number } | null>(null)
  const [shareRequest, setShareRequest] = useState<{ nonce: number } | null>(null)
  const [importRequest, setImportRequest] = useState<{ nonce: number; payload: string } | null>(null)
  const [lawRequest, setLawRequest] = useState<{ nonce: number; law: unknown } | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [hasBranch, setHasBranch] = useState(false)
  const [experimentText, setExperimentText] = useState('')
  const [experimentStatus, setExperimentStatus] = useState('Snapshots include laws, timers, physics state, cooldowns, and selection.')
  const initialShare = readInitialShare()
  const [shareUrl, setShareUrl] = useState(initialShare.url)
  const [shareStatus, setShareStatus] = useState(initialShare.status)
  const [livePrompt, setLivePrompt] = useState('')
  const [liveProposal, setLiveProposal] = useState<LiveProposal | null>(null)
  const [liveStatus, setLiveStatus] = useState('Prepared suggestions stay local. Review, then apply.')
  const [liveBusy, setLiveBusy] = useState(false)
  const [operatorToken, setOperatorToken] = useState('')
  const [demoStep, setDemoStep] = useState(0)
  const [demoRunning, setDemoRunning] = useState(false)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [paused, setPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [stepRequest, setStepRequest] = useState<{ nonce: number } | null>(null)
  const [simulationTick, setSimulationTick] = useState(0)
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetrics | null>(null)
  const [replayCheckpoints, setReplayCheckpoints] = useState<ReplayCheckpoint[]>([])
  const [replayCursor, setReplayCursor] = useState(0)
  const [replayRequest, setReplayRequest] = useState<{ nonce: number; checkpoint: ReplayCheckpoint } | null>(null)
  const [replayMarkers, setReplayMarkers] = useState<number[]>([])
  const audioContext = useRef<AudioContext | null>(null)
  const activeVoices = useRef(0)
  const voiceNodes = useRef(new Set<OscillatorNode>())
  const actionNonce = useRef(0)
  const liveAbort = useRef<AbortController | null>(null)
  const demoTimers = useRef<number[]>([])
  const ledgerId = useRef(0)
  const replayFollow = useRef(true)
  const downloadNextExport = useRef(false)
  const pendingSharedExperiment = useRef<unknown | null>(initialShare.value)
  const shareImportPending = useRef(false)
  const nextNonce = () => { actionNonce.current += 1; return actionNonce.current }

  const stopAudio = useCallback(() => {
    for (const oscillator of voiceNodes.current) { try { oscillator.stop() } catch { /* already ended */ } }
    voiceNodes.current.clear()
    activeVoices.current = 0
  }, [])
  useEffect(() => () => {
    for (const timer of demoTimers.current) window.clearTimeout(timer)
    liveAbort.current?.abort()
    stopAudio()
    void audioContext.current?.close()
  }, [stopAudio])

  useEffect(() => {
    if (replayFollow.current) setReplayCursor(Math.max(0, replayCheckpoints.length - 1))
  }, [replayCheckpoints])

  const enableAudio = async () => {
    if (audioEnabled) {
      stopAudio()
      setAudioEnabled(false)
      setAudioStatus('Sound is off.')
      return
    }
    const AudioContextClass = window.AudioContext ?? (window as AudioWindow).webkitAudioContext
    if (!AudioContextClass) { setAudioStatus('This browser cannot play Web Audio. Visual events still work.'); return }
    try {
      const context = audioContext.current ?? new AudioContextClass()
      audioContext.current = context
      await context.resume()
      setAudioEnabled(context.state === 'running')
      setAudioStatus(context.state === 'running' ? 'Impact sounds enabled. Select Mute audio to silence them.' : 'Sound is suspended; try enabling it again.')
    } catch { setAudioStatus('Sound could not start. Visual events still work.') }
  }

  const playNote = useCallback((frequency: number, maxVoices: number) => {
    const context = audioContext.current
    if (!audioEnabled || !context || activeVoices.current >= maxVoices) return
    activeVoices.current += 1
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.14)
    oscillator.connect(gain).connect(context.destination)
    voiceNodes.current.add(oscillator)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.15)
    oscillator.addEventListener('ended', () => {
      voiceNodes.current.delete(oscillator)
      oscillator.disconnect()
      gain.disconnect()
      activeVoices.current = voiceNodes.current.size
    }, { once: true })
  }, [audioEnabled])

  const addLedgerEntry = useCallback((tone: LedgerTone, title: string, detail: string) => {
    ledgerId.current += 1
    const entry: LedgerEntry = { id: ledgerId.current, tone, title, detail }
    setLedger(current => [entry, ...current].slice(0, 16))
  }, [])

  const handleEvent = useCallback((event: SimulationEvent) => {
    if (event.type === 'collision-note') {
      setLastNote(event)
      playNote(event.frequency, event.maxVoices ?? 4)
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
    if (downloadNextExport.current) {
      downloadNextExport.current = false
      const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'rulebreaker-experiment.json'
      link.click()
      URL.revokeObjectURL(url)
    }
  }, [addLedgerEntry])
  const handleImportResult = useCallback((result: { ok: boolean; message: string }) => {
    setExperimentStatus(result.message)
    if (shareImportPending.current) {
      shareImportPending.current = false
      setShareStatus(result.ok ? 'Shared experiment restored. Change a law to make this room yours.' : 'Share link refused; the current room stayed unchanged.')
    }
    addLedgerEntry('restore', result.ok ? 'Experiment imported' : 'Experiment import refused', result.message)
  }, [addLedgerEntry])
  const handleShare = useCallback((snapshot: Experiment) => {
    const url = createExperimentShareUrl(snapshot, window.location.href)
    setShareUrl(url)
    setExperimentText(JSON.stringify(snapshot, null, 2))
    setShareStatus('Share link ready. It contains this validated snapshot and no credentials.')
    const clipboard = navigator.clipboard
    if (clipboard) void clipboard.writeText(url).then(
        () => setShareStatus('Share link copied. Anyone with it can open this exact room state.'),
        () => undefined,
      )
    addLedgerEntry('restore', 'Share link created', `validated snapshot at tick ${snapshot.tick}`)
  }, [addLedgerEntry])
  const handleWorldReady = useCallback((ready: boolean) => {
    setWorldReady(ready)
    if (!ready || pendingSharedExperiment.current === null) return
    const payload = JSON.stringify(pendingSharedExperiment.current)
    pendingSharedExperiment.current = null
    shareImportPending.current = true
    setExperimentText(payload)
    actionNonce.current += 1
    setImportRequest({ nonce: actionNonce.current, payload })
  }, [])
  const handleLawResult = useCallback((result: { ok: boolean; message: string }) => {
    setLiveStatus(result.message)
    if (result.ok) addLedgerEntry('law', 'Law applied to the engine', result.message)
  }, [addLedgerEntry])
  const readLawState = useCallback((snapshot: Experiment) => {
    const scales = Object.fromEntries(snapshot.bodies.map(body => [body.id, body.gravityScale]))
    setGravityScales(current => snapshot.bodies.every(body => current[body.id] === body.gravityScale) ? current : scales)
    setCollisionPolicy(current => JSON.stringify(current) === JSON.stringify(snapshot.collisionNoteLaw) ? current : snapshot.collisionNoteLaw)
  }, [])
  const readSnapshot = useCallback((snapshot: Experiment) => {
    readLawState(snapshot)
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
  }, [readLawState])
  const handleRestored = useCallback((snapshot: Experiment) => {
    readSnapshot(snapshot)
    setReplayCheckpoints([{ tick: snapshot.tick, snapshot }])
    setReplayMarkers([])
    setReplayCursor(0)
    replayFollow.current = true
    stopAudio()
    setPaused(true)
    addLedgerEntry('restore', 'Snapshot restored', `tick ${snapshot.tick} · ${snapshot.bodies.length} bodies`)
  }, [addLedgerEntry, readSnapshot, stopAudio])
  const handleCheckpoint = useCallback((snapshot: Experiment) => {
    readLawState(snapshot)
    const branching = !replayFollow.current
    replayFollow.current = true
    setReplayCheckpoints(current => upsertReplayCheckpoint(branching ? branchReplay(current, snapshot.tick) : current, snapshot))
  }, [readLawState])
  const handleReplayMarker = useCallback((tick: number) => {
    setReplayMarkers(current => current.includes(tick) ? current : [...current, tick].sort((left, right) => left - right).slice(-96))
  }, [])
  const commitReplayBranch = () => {
    if (!replayFollow.current) {
      setReplayCheckpoints(current => branchReplay(current, simulationTick))
      setReplayMarkers(current => current.filter(tick => tick <= simulationTick))
      replayFollow.current = true
      addLedgerEntry('restore', 'New replay branch', `continuing from tick ${simulationTick}`)
    }
  }
  const requestFreeze = () => {
    if (!selectedId) return
    commitReplayBranch()
    setFreezeRequest({ id: selectedId, nonce: nextNonce() })
    addLedgerEntry('freeze', `Freeze requested · ${displayName(selectedId)}`, '180 simulation ticks')
  }
  const toggleGravity = () => {
    commitReplayBranch()
    const next = !upward
    setUpward(next)
    addLedgerEntry('law', next ? 'Prepared law applied · inverted gravity' : 'Prepared law restored · ordinary gravity', 'scope: blue objects')
  }
  const toggleCollisionNotes = () => {
    commitReplayBranch()
    const next = !collisionNotes
    setCollisionNotes(next)
    addLedgerEntry('law', next ? 'Prepared law applied · collision notes' : 'Prepared law silenced', next ? 'threshold 1.2 m/s · cooldown 24 ticks · four voices' : 'collision-note policy removed')
  }
  const togglePaused = () => {
    const next = !paused
    if (paused && !next) {
      commitReplayBranch()
      setReplayCursor(Math.max(0, replayCheckpoints.length - 1))
    }
    setPaused(next)
    addLedgerEntry('restore', next ? 'Simulation paused' : 'Simulation resumed', `clock tick ${simulationTick}`)
  }
  const stepSimulation = () => {
    if (!paused) return
    commitReplayBranch()
    setStepRequest({ nonce: nextNonce() })
    addLedgerEntry('restore', 'Simulation advanced one tick', `from tick ${simulationTick}`)
  }
  const scrubReplay = (index: number) => {
    const checkpoint = checkpointAtIndex(replayCheckpoints, index)
    if (!checkpoint) return
    replayFollow.current = false
    stopAudio()
    setReplayCursor(index)
    setPaused(true)
    setReplayRequest({ nonce: nextNonce(), checkpoint })
    addLedgerEntry('restore', 'Replay checkpoint selected', `restoring simulation tick ${checkpoint.tick}`)
  }
  const resetRoom = () => {
    downloadNextExport.current = false
    liveAbort.current?.abort()
    liveAbort.current = null
    setLiveBusy(false)
    setOperatorToken('')
    setWorldReady(false)
    setGoalProgress(0)
    stopAudio()
    for (const timer of demoTimers.current) window.clearTimeout(timer)
    demoTimers.current = []
    setDemoRunning(false)
    setDemoStep(0)
    setUpward(false)
    setGravityScales(Object.fromEntries(sample.objects.map(object => [object.id, 1])))
    setCollisionPolicy(null)
    setCollisionNotes(false)
    setFreezeOnClick(false)
    setSelectedId(null)
    setFreezeRequest(null)
    setFrozen({})
    setLastNote(null)
    setHistoryAction(null)
    setExportRequest(null)
    setShareRequest(null)
    setImportRequest(null)
    setLawRequest(null)
    setLiveProposal(null)
    setLiveStatus('Prepared suggestions stay local. Review, then apply.')
    setCanUndo(false)
    setHasBranch(false)
    setPaused(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    setStepRequest(null)
    setSimulationTick(0)
    setRuntimeMetrics(null)
    setReplayCheckpoints([])
    setReplayCursor(0)
    setReplayRequest(null)
    setReplayMarkers([])
    replayFollow.current = true
    setExperimentStatus('Room reset. Import an experiment snapshot here to restore it.')
    setShareUrl('')
    setShareStatus(DEFAULT_SHARE_STATUS)
    pendingSharedExperiment.current = null
    shareImportPending.current = false
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    setLedger([])
    setReset(value => value + 1)
  }

  const requestExport = () => setExportRequest({ nonce: nextNonce() })
  const requestShare = () => {
    setShareStatus('Creating a validated share link…')
    setShareRequest({ nonce: nextNonce() })
  }
  const requestDownload = () => { downloadNextExport.current = true; requestExport() }
  const loadExperimentFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 65536) { setExperimentStatus('Choose a JSON experiment under 64 KB.'); return }
    try {
      setExperimentText(await file.text())
      setExperimentStatus('File loaded for review. Choose Import into room to validate and restore it.')
    } catch { setExperimentStatus('The file could not be read. Your room is unchanged.') }
  }
  const requestImport = () => setImportRequest({ nonce: nextNonce(), payload: experimentText })
  const runGuidedDemo = () => {
    resetRoom()
    setPaused(false)
    setDemoRunning(true)
    setDemoStep(1)
    setCollisionNotes(true)
  }
  const handleTick = useCallback((tick: number) => {
    setSimulationTick(tick)
    if (!demoRunning || !worldReady) return
    if (demoStep === 1 && tick >= 90) {
      setUpward(true)
      setDemoStep(2)
      addLedgerEntry('law', 'Guided step · inverted gravity', 'blue prisms now rise')
    } else if (demoStep === 2 && tick >= 174) {
      setSelectedId('blue-a')
      actionNonce.current += 1
      setFreezeRequest({ id: 'blue-a', nonce: actionNonce.current })
      setDemoStep(3)
    } else if (demoStep === 3 && tick >= 354 && !frozen['blue-a']) {
      setDemoStep(4)
      setDemoRunning(false)
    }
  }, [demoRunning, demoStep, worldReady, frozen, addLedgerEntry])
  const requestPreparedProposal = () => {
    liveAbort.current?.abort()
    liveAbort.current = null
    setLiveBusy(false)
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
    const token = operatorToken.trim()
    if (!/^[!-~]{1,256}$/.test(token)) {
      setLiveStatus('Live AI requires an operator access token. Prepared interpretation remains available.')
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
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt: livePrompt, scene: sample }),
        signal: controller.signal,
      })
      if (liveAbort.current !== controller) return
      const payload = await response.json() as { error?: string } & Partial<LiveProposal>
      if (!response.ok) throw new Error(payload.error ?? `Live interpreter returned HTTP ${response.status}`)
      if (payload.mode !== 'live-ai' || !payload.law || typeof payload.interpretation !== 'string') throw new Error('Live interpreter returned an incomplete proposal.')
      if (liveAbort.current !== controller) return
      const proposal = { ...payload, law: validateLaw(validatedScene, payload.law) } as LiveProposal
      setLiveProposal(proposal)
      setLiveStatus(`Validated ${proposal.law.operation} from ${proposal.model}. Review it before applying.`)
    } catch (error) {
      if (liveAbort.current !== controller || (error instanceof DOMException && error.name === 'AbortError')) return
      setLiveProposal(null)
      setLiveStatus(error instanceof Error ? error.message : 'Live interpretation failed.')
    } finally {
      if (liveAbort.current === controller) { liveAbort.current = null; setLiveBusy(false) }
    }
  }
  const applyLiveProposal = () => {
    if (!liveProposal) return
    commitReplayBranch()
    const law = liveProposal.law
    setLawRequest({ nonce: nextNonce(), law })
    setLiveStatus(liveProposal.mode === 'prepared' ? 'Applying the prepared interpretation…' : 'Applying the validated live proposal…')
    setLiveProposal(null)
    addLedgerEntry('law', liveProposal.mode === 'prepared' ? 'Prepared interpretation applied' : 'Live proposal approved', liveProposal.interpretation)
  }

  const selectedName = selectedId ? displayName(selectedId) : 'Nothing selected'
  const frozenNames = Object.keys(frozen).map(displayName)
  const selectedCheckpoint = checkpointAtIndex(replayCheckpoints, replayCursor)
  const gravityActive = Object.values(gravityScales).some(scale => scale !== 1)
  const blueCustomGravity = sample.objects.some(object => object.color === 'blue' && gravityScales[object.id] !== 1) && !upward

  return <main>
    <a className="skip-link" href="#room">Skip to room</a>
    <header className="hero">
      <div>
        <span className="eyebrow">RULEBREAKER / IMPOSSIBLE ROOM</span>
        <h1>The rules are yours to break.</h1>
        <p className="lede">Make blue shapes rise. Turn impacts into music. Freeze a moment, then rewind and take another path.</p>
      </div>
      <div className="mode-card" aria-label="Runtime mode">
        <span className="mode-dot" aria-hidden="true" />
        <div><strong>Prepared mode</strong><span>No key needed · your experiments stay local</span></div>
      </div>
    </header>

    <div className="play-workspace">
    <section id="room" className="stage" aria-label="Impossible Room">
      <RoomBoundary key={reset}><Suspense fallback={<div className="world world-loading" role="status">Building your room…</div>}>
      <World
        key={reset}
        upward={upward}
        collisionNotes={collisionNotes}
        freezeOnClick={freezeOnClick}
        freezeRequest={freezeRequest}
        selectedId={selectedId}
        historyAction={historyAction}
        exportRequest={exportRequest}
        shareRequest={shareRequest}
        importRequest={importRequest}
        lawRequest={lawRequest}
        onHeight={setHeight}
        onSelected={selectObject}
        onEvent={handleEvent}
        onHistoryState={handleHistoryState}
        onExport={handleExport}
        onShare={handleShare}
        onImportResult={handleImportResult}
        onLawResult={handleLawResult}
        onRestored={handleRestored}
        onLawApplied={readSnapshot}
        paused={paused}
        stepRequest={stepRequest}
        onTick={handleTick}
        onMetrics={setRuntimeMetrics}
        replayRequest={replayRequest}
        onCheckpoint={handleCheckpoint}
        onReplayMarker={handleReplayMarker}
        onReplayRestored={readSnapshot}
        onReady={handleWorldReady}
        onGoalProgress={setGoalProgress}
      />
      </Suspense></RoomBoundary>
      <div className="stage-caption"><span>DRAG TO ORBIT</span><span>SCROLL TO ZOOM</span><span>CLICK TO SELECT</span></div>
      <div className={`room-mission ${goalProgress === 2 ? 'complete' : ''}`} aria-live="polite"><span>MISSION 01</span><strong>{goalProgress === 2 ? 'Ceiling expedition complete' : 'Get both blue shapes to the ceiling'}</strong><small>{goalProgress} / 2 blue shapes above 8.8 m</small></div>
      <div className="stage-controls" aria-label="Simulation controls"><button className="stage-control-button" disabled={!worldReady} onClick={togglePaused}>{paused ? 'Resume room' : 'Pause room'}</button><button className="stage-control-button" disabled={!worldReady || !paused} onClick={stepSimulation}>Step 1 tick</button><span className={paused ? 'clock-state paused' : 'clock-state'}>{paused ? 'PAUSED' : 'LIVE'} · TICK {simulationTick}</span></div>
    </section>

    <section className="lab-grid">
      <div className="panel laws-panel">
        <div className="panel-heading"><div><span className="panel-kicker">01 / LAWS</span><h2>Rewrite the room</h2></div><div className="heading-actions"><span className="law-count">{[gravityActive, collisionNotes, Object.keys(frozen).length > 0].filter(Boolean).length} active</span><button className="reset-button" onClick={resetRoom}>Reset</button></div></div>
        <p className="panel-copy">Pick a law. Watch what changes.</p>

        <article className={`law-card ${upward ? 'is-active' : ''}`}>
          <div className="law-index gravity-index">A</div>
          <div className="law-body"><h3>Blue objects fall upward</h3><p>{blueCustomGravity ? 'Custom gravity is active. Apply this preset to give both blue shapes scale −1.' : 'Send the blue shapes to the ceiling. Inspect each body’s current gravity below.'}</p><div className="law-meta"><span>{upward ? 'ACTIVE' : blueCustomGravity ? 'CUSTOM' : 'READY'}</span><span>preset scope: blue</span></div></div>
          <button className="small-button" disabled={!worldReady} onClick={toggleGravity}>{upward ? 'Restore' : 'Apply'}</button>
        </article>

        <article className={`law-card ${collisionNotes ? 'is-active' : ''}`}>
          <div className="law-index note-index">B</div>
          <div className="law-body"><h3>Every collision plays a note</h3><p>Give every meaningful impact a voice. Enable audio below to listen.</p><div className="law-meta"><span>{collisionNotes ? 'ACTIVE' : 'READY'}</span><span>scope: {collisionPolicy ? collisionPolicy.targets.map(displayName).join(', ') : 'all objects on apply'}</span></div>{collisionPolicy && <small>{collisionPolicy.threshold} m/s · {collisionPolicy.cooldownTicks} tick cooldown · {collisionPolicy.maxVoices} voices</small>}</div>
          <button className="small-button" disabled={!worldReady} onClick={toggleCollisionNotes}>{collisionNotes ? 'Silence' : 'Listen'}</button>
        </article>

        <article className={`law-card ${freezeOnClick ? 'is-active' : ''}`}>
          <div className="law-index freeze-index">C</div>
          <div className="law-body"><h3>Click to freeze for three seconds</h3><p>Hold a shape still for three seconds of room time. Its other laws stay intact.</p><div className="law-meta"><span>{freezeOnClick ? 'CLICK MODE' : 'READY'}</span><span>scope: selected</span></div></div>
          <button className="small-button" disabled={!worldReady} onClick={() => setFreezeOnClick(current => !current)}>{freezeOnClick ? 'Exit mode' : 'Enter mode'}</button>
        </article>

        <div className="audio-row"><div><strong>Sound activation</strong><span>{audioStatus}</span></div><button className="secondary-button" onClick={enableAudio} >{audioEnabled ? 'Mute audio' : 'Enable audio'}</button></div>
      </div>

      <aside className="panel inspector-panel">
        <div className="panel-heading"><div><span className="panel-kicker">02 / INSPECTOR</span><h2>Inspect a body</h2></div><span className="selection-pip" aria-hidden="true" /></div>
        <p className="panel-copy">Click a shape in the room or choose one below.</p>
        <div className="object-list" aria-label="Room objects">
          {sample.objects.map(object => <button key={object.id} className={`object-button ${selectedId === object.id ? 'is-selected' : ''}`} onClick={() => selectObject(object.id)} aria-pressed={selectedId === object.id}><span className={`object-swatch ${object.color}`} /><span><strong>{displayName(object.id)}</strong><small>{object.color} · {frozen[object.id] ? 'frozen' : 'dynamic'} · gravity {gravityScales[object.id]}</small></span><span className="chevron">{selectedId === object.id ? '●' : '○'}</span></button>)}
        </div>
        <div className="selection-readout"><span>Selected</span><strong>{selectedName}</strong></div>
        <button className="freeze-button" disabled={!worldReady || !selectedId} onClick={requestFreeze}>Freeze {selectedId ? displayName(selectedId) : 'selected body'} for 3 seconds</button>
        {frozenNames.length > 0 && <div className="frozen-strip"><span className="pulse" />Frozen now: {frozenNames.join(', ')}</div>}
      </aside>
    </section>

    </div>

    <section className="panel live-panel" aria-label="Live AI interpreter">
      <div className="panel-heading"><div><span className="panel-kicker">COMPOSE / PREPARED</span><h2>Describe your next law</h2></div><span className="live-badge">no key needed</span></div>
      <p className="panel-copy">Try “make the blue shapes rise”, “turn impacts into little tones”, or select a shape and ask to hold it still. Review the affected shapes before applying.</p>
      <div className="live-form"><input aria-label="Law prompt" value={livePrompt} onChange={event => setLivePrompt(event.target.value)} placeholder="e.g. make the blue shapes rise" maxLength={500} /><button className="small-button" onClick={requestPreparedProposal}>Try prepared</button></div>
      <div className="live-status" role="status">{liveStatus}</div>
      <details className="provider-tools"><summary>Optional live AI</summary><p>Requires an enabled server and an operator access token. This access token stays in this page’s memory and is cleared by Reset. Provider keys stay on the server. Prepared interpretation always works without either.</p><label>Operator access token <input aria-label="Operator access token" type="password" value={operatorToken} maxLength={256} autoComplete="off" onChange={event => setOperatorToken(event.target.value)} /></label><button className="secondary-button" disabled={liveBusy || !operatorToken.trim()} onClick={requestLiveProposal}>{liveBusy ? 'Thinking…' : 'Ask live AI'}</button>{liveBusy && <button className="secondary-button" onClick={() => { liveAbort.current?.abort(); liveAbort.current = null; setLiveBusy(false); setLiveStatus('Live request cancelled. Your room is unchanged.') }}>Cancel request</button>}</details>
      {liveProposal && <div className="proposal-card"><div><span className="panel-kicker">{liveProposal.mode === 'prepared' ? 'PREPARED INTERPRETATION' : 'VALIDATED LIVE PROPOSAL'}</span><strong>{liveProposal.interpretation}</strong><span>{liveProposal.law.targets.map(displayName).join(', ')}</span></div><div className="proposal-actions"><button className="freeze-button" disabled={!worldReady} onClick={applyLiveProposal}>Apply proposal</button><button className="secondary-button" onClick={() => setLiveProposal(null)}>Discard</button></div></div>}
    </section>

    <section className="panel demo-panel" aria-label="Impossible Room guided demo">
      <div className="panel-heading"><div><span className="panel-kicker">GUIDED / IMPOSSIBLE ROOM</span><h2>See the three laws compose</h2></div><span className="law-count">{demoStep === 4 ? 'complete' : '3 steps'}</span></div>
      <p className="panel-copy">Run the no-key route once: listen for impact events, invert blue gravity, then freeze a selected body. When it ends, invent a variation with the prepared controls.</p>
      <div className="demo-actions"><button className="freeze-button" disabled={demoRunning || !worldReady} onClick={runGuidedDemo}>{demoRunning ? 'Demo running…' : 'Run Impossible Room demo'}</button><span aria-live="polite">{demoStep === 0 ? 'Ready when you are.' : demoStep === 1 ? 'Step 1 · collision-note law is active.' : demoStep === 2 ? 'Step 2 · blue prisms are rising.' : demoStep === 3 ? 'Step 3 · Blue prism A is frozen for three seconds.' : 'Demo complete · now write a stranger law.'}</span></div>
      <ol className="demo-steps"><li className={demoStep >= 1 ? 'is-done' : ''}>Listen to meaningful collisions</li><li className={demoStep >= 2 ? 'is-done' : ''}>Invert blue gravity</li><li className={demoStep >= 3 ? 'is-done' : ''}>Freeze the selected body</li></ol>
    </section>

    <section className="panel replay-panel" aria-label="Replay timeline">
      <div className="panel-heading"><div><span className="panel-kicker">04 / REPLAY</span><h2>Scrub the room’s memory</h2></div><span className="law-count">{replayCheckpoints.length} checkpoints</span></div>
      <p className="panel-copy">Travel back through the last 24 seconds. Browsing keeps your future intact. Resume or apply a law to start a new branch.</p>
      <div className="replay-actions">
        <button className="secondary-button" disabled={replayCheckpoints.length < 2 || replayCursor === 0} onClick={() => scrubReplay(replayCursor - 1)}>Previous</button>
        <button className="secondary-button" disabled={replayCheckpoints.length < 2 || replayCursor >= replayCheckpoints.length - 1} onClick={() => scrubReplay(replayCursor + 1)}>Next</button>
        <button className="secondary-button" disabled={replayCheckpoints.length < 2 || replayCursor === replayCheckpoints.length - 1} onClick={() => scrubReplay(replayCheckpoints.length - 1)}>Latest</button>
      </div>
      <input className="replay-slider" aria-label="Replay timeline" type="range" min="0" max={Math.max(replayCheckpoints.length - 1, 0)} step="1" value={replayCursor} disabled={replayCheckpoints.length < 2} onChange={event => scrubReplay(Number(event.target.value))} aria-valuetext={selectedCheckpoint ? `simulation tick ${selectedCheckpoint.tick}` : 'recording checkpoints'} />
      <div className="replay-track" aria-hidden="true">
        <span className="replay-track-fill" style={{ width: replayCheckpoints.length > 1 ? `${(replayCursor / (replayCheckpoints.length - 1)) * 100}%` : '0%' }} />
        {replayMarkers.filter(tick => tick >= (replayCheckpoints[0]?.tick ?? 0) && tick <= (replayCheckpoints.at(-1)?.tick ?? 0)).map(tick => <span key={tick} className="replay-marker" style={{ left: replayCheckpoints.length > 1 ? `${Math.max(0, Math.min(100, ((tick - replayCheckpoints[0]!.tick) / Math.max(replayCheckpoints[replayCheckpoints.length - 1]!.tick - replayCheckpoints[0]!.tick, 1)) * 100))}%` : '0%' }} />)}
      </div>
      <div className="replay-readout" aria-live="polite">{selectedCheckpoint ? <><strong>Checkpoint tick {selectedCheckpoint.tick}</strong><span>{paused ? 'paused · browse forward or resume to branch' : 'recording live'}</span></> : <span>Collecting the first checkpoint…</span>}</div>
    </section>

    <section className="telemetry-row" aria-label="Live room telemetry">
      <div><span className="telemetry-label">BLUE A HEIGHT</span><strong>{height.toFixed(2)} <small>m</small></strong><span>gravity scale {gravityScales['blue-a']} · {frozen['blue-a'] ? 'frozen' : 'dynamic'}</span></div>
      <div><span className="telemetry-label">LAST IMPACT</span><strong>{lastNote ? `${lastNote.impact.toFixed(1)} m/s` : 'waiting'}</strong><span>{lastNote ? `${displayName(lastNote.first)} → ${lastNote.second === 'room' ? 'room boundary' : displayName(lastNote.second)}` : 'turn on collision notes to listen'}</span></div>
      <div><span className="telemetry-label">UNDO / BRANCH</span><strong>{canUndo ? 'Ready' : 'Waiting'}</strong><span>{hasBranch ? 'One branch is saved locally.' : 'Save a branch before trying a new path.'}</span></div>
    </section>

    <details className="advanced-tools"><summary>Experiment tools &amp; diagnostics <span>Save, import, inspect events and measure performance</span></summary>
    <section className="panel experiment-panel" aria-label="Experiment history and import">
      <div className="panel-heading"><div><span className="panel-kicker">03 / EXPERIMENT</span><h2>Undo, branch, and carry the room</h2></div><span className="law-count">{canUndo ? 'undo ready' : 'new timeline'}</span></div>
      <p className="panel-copy">Snapshots use <code>rulebreaker/experiment/v1</code>. They restore physics state, active laws, freeze timers, collision cooldowns, and the selected body without another model request.</p>
      <div className="experiment-actions">
        <button className="secondary-button" disabled={!worldReady || !canUndo} onClick={() => runHistoryAction('undo')}>Undo last law</button>
        <button className="secondary-button" disabled={!worldReady} onClick={() => runHistoryAction('save-branch')}>Save branch</button>
        <button className="secondary-button" disabled={!worldReady || !hasBranch} onClick={() => runHistoryAction('restore-branch')}>Restore branch</button>
        <button className="secondary-button" disabled={!worldReady} onClick={requestExport}>Export JSON</button>
        <button className="secondary-button" disabled={!worldReady} onClick={requestDownload}>Download JSON</button>
        <button className="secondary-button" disabled={!worldReady} onClick={requestShare}>Share room state</button>
      </div>
      <div className="share-row">
        <label htmlFor="share-link">Share link</label>
        <input id="share-link" aria-label="Share link" readOnly value={shareUrl} placeholder="Create a link after changing the room." onFocus={event => event.currentTarget.select()} />
        <span role="status">{shareStatus}</span>
      </div>
      <label className="experiment-file">Load a saved experiment <input aria-label="Load experiment file" type="file" accept=".json,application/json" onChange={event => { void loadExperimentFile(event.target.files?.[0]); event.target.value = '' }} /></label>
      <textarea aria-label="Experiment JSON" value={experimentText} onChange={event => setExperimentText(event.target.value)} placeholder="Export a snapshot or paste a rulebreaker/experiment/v1 document here." maxLength={65536} rows={5} />
      <div className="import-row"><button className="freeze-button" disabled={!worldReady || !experimentText.trim()} onClick={requestImport}>Import into room</button><span>{experimentStatus}</span></div>
    </section>

    <section className="panel ledger-panel" aria-label="Recent room events">
      <div className="panel-heading"><div><span className="panel-kicker">05 / EVENT LEDGER</span><h2>Watch the consequences accumulate</h2></div><span className="law-count">{ledger.length} recent</span></div>
      <p className="panel-copy">The ledger records engine events and timeline actions so an experiment stays inspectable after the motion settles.</p>
      {ledger.length === 0 ? <div className="ledger-empty">No events yet. Apply a law or run the guided room.</div> : <ol className="ledger-list">{ledger.slice(0, 8).map(entry => <li key={entry.id} className={`ledger-entry ${entry.tone}`}><span className="ledger-mark" /><div><strong>{entry.title}</strong><span>{entry.detail}</span></div></li>)}</ol>}
    </section>

    <section className="panel runtime-panel" aria-label="Runtime telemetry">
      <div className="panel-heading"><div><span className="panel-kicker">06 / RUNTIME</span><h2>Measure the room</h2></div><span className="law-count">{runtimeMetrics ? 'live sample' : 'warming up'}</span></div>
      <p className="panel-copy">Measured from the browser’s render loop over the latest half-second window. Physics cadence is Rapier ticks per second; resource counts are renderer-reported scene totals.</p>
      <div className="runtime-grid">
        <div><span className="telemetry-label">FRAME TIME</span><strong>{runtimeMetrics ? <>{runtimeMetrics.frameMs.toFixed(1)} <small>ms</small></> : '—'}</strong><span>{runtimeMetrics ? `${runtimeMetrics.fps.toFixed(1)} measured FPS` : 'Collecting a sample…'}</span></div>
        <div><span className="telemetry-label">PHYSICS CADENCE</span><strong>{runtimeMetrics ? <>{runtimeMetrics.physicsHz.toFixed(1)} <small>Hz</small></> : '—'}</strong><span>{runtimeMetrics ? `${runtimeMetrics.tickDelta} ticks in ${Math.round(runtimeMetrics.sampleWindowMs)} ms` : 'Waiting for fixed-step samples'}</span></div>
        <div><span className="telemetry-label">RENDER WORK</span><strong>{runtimeMetrics ? <>{runtimeMetrics.drawCalls} <small>calls</small></> : '—'}</strong><span>{runtimeMetrics ? `${runtimeMetrics.triangles} triangles per frame` : 'Renderer counters unavailable'}</span></div>
        <div><span className="telemetry-label">SCENE RESOURCES</span><strong>{runtimeMetrics ? <>{runtimeMetrics.objectCount} <small>bodies</small></> : '—'}</strong><span>{runtimeMetrics ? `${runtimeMetrics.geometries} geometries · ${runtimeMetrics.textures} textures · DPR ${runtimeMetrics.pixelRatio.toFixed(1)}` : 'Collecting renderer totals'}</span></div>
      </div>
    </section>

    </details>

    <footer><span>Rulebreaker · a physics playground</span><span>Prepared laws · local experiments · open source</span><a href="https://github.com/jonah-ux/rulebreaker" target="_blank" rel="noreferrer">View source ↗</a></footer>
  </main>
}
