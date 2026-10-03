import { useState } from 'react'
import { World } from './World'
import './App.css'

export default function App() {
  const [upward, setUpward] = useState(false)
  const [reset, setReset] = useState(0)
  const [height, setHeight] = useState(4)
  return <main>
    <header><span className="eyebrow">RULEBREAKER / ENGINE STARTER</span><h1>Give gravity a new rule.</h1><p>A small working foundation for the world you will build.</p></header>
    <div className="status">Prepared law · live AI interpretation is not implemented</div>
    <World key={reset} upward={upward} onHeight={setHeight} />
    <section className="panel"><div><h2>Blue objects {upward ? 'fall upward' : 'follow ordinary gravity'}.</h2><p>Red and gold objects keep ordinary gravity. The upper grid is the room boundary.</p></div>
      <div className="actions"><button onClick={() => setUpward(value => !value)}>{upward ? 'Restore ordinary gravity' : 'Apply blue objects fall upward'}</button><button className="secondary" onClick={() => { setUpward(false); setReset(value => value + 1) }}>Reset room</button></div>
      <output aria-label="Blue object height">Blue object height: {height.toFixed(2)}</output>
    </section>
    <footer>Next: AI law proposals, scoped interactions, sound, complete undo and replay. Read docs/BUILD-PROMPT.md.</footer>
  </main>
}
