import { Component } from 'react'
import type { ReactNode } from 'react'

export class RoomBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  render() {
    if (this.state.failed) return <div className="world world-loading" role="alert"><div><h2>The room could not start</h2><p>Check WebGL support and your connection, then reload to retry loading the engine.</p><button className="secondary-button" onClick={() => window.location.reload()}>Reload page</button></div></div>
    return this.props.children
  }
}
