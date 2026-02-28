import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'

export default function CanvasPage() {
    // on page load, get saved TLShapes from API

    // on save, post TLShapes to API

    return (
    <div style={{ position: 'fixed', inset: 0 }}>
        <Tldraw />
    </div>
  )
}
