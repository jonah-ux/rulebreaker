import { useCallback, useRef, useState } from 'react'
import sample from './scene.json'
import { World } from './World'
import type { SimulationEvent } from './simulation'
import './App.css'

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext }

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
  const audioContext = useRef<AudioContext | null>(null)
  const activeVoices = useRef(0)

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

  const handleEvent = useCallback((event: SimulationEvent) => {
    if (event.type === 'collision-note') {
      setLastNote(event)
      playNote(event.frequency)
    } else if (event.type === 'freeze-applied') {
      setFrozen(current => ({ ...current, [event.target]: event.expiresAtTick }))
    } else {
      setFrozen(current => {
        const next = { ...current }
        delete next[event.target]
        return next
      })
    }
  }, [playNote])

  const selectObject = useCallback((id: string) => setSelectedId(id), [])
  const requestFreeze = () => {
    if (!selectedId) return
    setFreezeRequest({ id: selectedId, nonce: Date.now() })
  }
  const resetRoom = () => {
    setUpward(false)
    setCollisionNotes(false)
    setFreezeOnClick(false)
    setSelectedId(null)
    setFreezeRequest(null)
    setFrozen({})
    setLastNote(null)
    setReset(value => value + 1)
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

    <section className="stage" aria-label="Impossible Room">
      <World
        key={reset}
        upward={upward}
        collisionNotes={collisionNotes}
        freezeOnClick={freezeOnClick}
        freezeRequest={freezeRequest}
        selectedId={selectedId}
        onHeight={setHeight}
        onSelected={selectObject}
        onEvent={handleEvent}
      />
      <div className="stage-caption"><span>DRAG TO ORBIT</span><span>SCROLL TO ZOOM</span><span>CLICK TO SELECT</span></div>
    </section>

    <section className="lab-grid">
      <div className="panel laws-panel">
        <div className="panel-heading"><div><span className="panel-kicker">01 / LAWS</span><h2>Rewrite the room</h2></div><div className="heading-actions"><span className="law-count">{[upward, collisionNotes, Object.keys(frozen).length > 0].filter(Boolean).length} active</span><button className="reset-button" onClick={resetRoom}>Reset</button></div></div>
        <p className="panel-copy">Every prepared law is typed, scoped, and applied atomically by the physics engine.</p>

        <article className={`law-card ${upward ? 'is-active' : ''}`}>
          <div className="law-index gravity-index">A</div>
          <div className="law-body"><h3>Blue objects fall upward</h3><p>Blue prisms use gravity scale −1. Red and gold keep ordinary gravity.</p><div className="law-meta"><span>{upward ? 'ACTIVE' : 'READY'}</span><span>scope: blue</span></div></div>
          <button className="small-button" onClick={() => setUpward(current => !current)}>{upward ? 'Restore' : 'Apply'}</button>
        </article>

        <article className={`law-card ${collisionNotes ? 'is-active' : ''}`}>
          <div className="law-index note-index">B</div>
          <div className="law-body"><h3>Every collision plays a note</h3><p>Impacts above 1.2 m/s trigger a short tone, with a 24-tick pair cooldown and four-voice cap.</p><div className="law-meta"><span>{collisionNotes ? 'ACTIVE' : 'READY'}</span><span>scope: all objects</span></div></div>
          <button className="small-button" onClick={() => setCollisionNotes(current => !current)}>{collisionNotes ? 'Silence' : 'Listen'}</button>
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

    <section className="telemetry-row" aria-label="Live room telemetry">
      <div><span className="telemetry-label">BLUE HEIGHT</span><strong>{height.toFixed(2)} <small>m</small></strong><span>{upward ? 'rising under inverted gravity' : 'moving under ordinary gravity'}</span></div>
      <div><span className="telemetry-label">LAST IMPACT</span><strong>{lastNote ? `${lastNote.impact.toFixed(1)} m/s` : 'waiting'}</strong><span>{lastNote ? `${displayName(lastNote.first)} → ${lastNote.second === 'room' ? 'room boundary' : displayName(lastNote.second)}` : 'turn on collision notes to listen'}</span></div>
      <div><span className="telemetry-label">UNDO / BRANCH</span><strong>Next slice</strong><span>State history arrives after the typed laws.</span></div>
    </section>

    <footer><span>Prepared behavior is intentionally labeled.</span><span>Next: live model proposals, undo, branching, and replay.</span><a href="https://github.com/jonah-ux/rulebreaker" target="_blank" rel="noreferrer">View source ↗</a></footer>
  </main>
}
