import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  resizeBox,
  BaseBoxShapeTool,
} from 'tldraw'
import 'tldraw/tldraw.css'
import type { Geometry2d, RecordProps, TLResizeInfo, TLShape } from 'tldraw'
import { useState, useRef, useEffect } from 'react'

const BOT_SHAPE_TYPE = 'bot-shape'

// 1. Register the shape in Tldraw's global type system
declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    [BOT_SHAPE_TYPE]: { w: number; h: number }
  }
}

type IBotShape = TLShape<typeof BOT_SHAPE_TYPE>

// 2. The interactive React Component
function ChatbotUI() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<{role: 'user' | 'bot', text: string}[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to the bottom when a new message appears
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim()) return

    // Immediately show the user's message in the UI
    const userText = input
    setMessages(prev => [...prev, { role: 'user', text: userText }])
    setInput('')
    setIsLoading(true)

    try {
      // Call your FastAPI backend!
      const response = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText })
      })
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()

      // Show Gemini's reply in the UI
      setMessages(prev => [...prev, { role: 'bot', text: data.reply }])
    } catch (error) {
      console.error("Chat error:", error)
      setMessages(prev => [...prev, { role: 'bot', text: 'Error connecting to the AI server.' }])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <HTMLContainer style={{ 
      display: 'flex', flexDirection: 'column', height: '100%', width: '100%',
      backgroundColor: '#ffffff', borderRadius: '12px', 
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)', overflow: 'hidden',
      pointerEvents: 'all' // Crucial: lets you click buttons and type inside the shape!
    }}>
      {/* Header (Drag Area) */}
      <div style={{ background: '#3b82f6', color: 'white', padding: '10px 15px', fontWeight: 'bold', fontSize: '14px', cursor: 'grab' }}>
        ✨ Gemini Tutor
      </div>

      {/* Message History */}
      <div 
        ref={scrollRef}
        onPointerDown={(e) => e.stopPropagation()} // Prevents dragging the shape when highlighting text
        style={{ flexGrow: 1, padding: '15px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: '#f9fafb' }}
      >
        {messages.length === 0 && <span style={{color: '#9ca3af', fontStyle: 'italic', fontSize: '14px', textAlign: 'center', marginTop: '20px'}}>Ask me anything!</span>}
        
        {messages.map((msg, i) => (
          <div key={i} style={{ 
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            backgroundColor: msg.role === 'user' ? '#3b82f6' : '#e5e7eb',
            color: msg.role === 'user' ? 'white' : 'black',
            padding: '10px 14px', borderRadius: '12px', maxWidth: '85%', fontSize: '14px',
            lineHeight: '1.4'
          }}>
            {msg.text}
          </div>
        ))}
        {isLoading && <div style={{fontSize: '13px', color: '#6b7280', fontStyle: 'italic'}}>Gemini is typing...</div>}
      </div>

      {/* Input Area */}
      <div 
        onPointerDown={(e) => e.stopPropagation()} 
        onKeyDown={(e) => e.stopPropagation()} // Prevents Tldraw from hijacking Backspace/Enter keys
        style={{ display: 'flex', padding: '10px', borderTop: '1px solid #e5e7eb', backgroundColor: 'white' }}
      >
        <input 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Type a message..."
          style={{ flexGrow: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', outline: 'none', fontSize: '14px' }}
        />
        <button 
          onClick={sendMessage} 
          disabled={isLoading || !input.trim()}
          style={{ marginLeft: '10px', padding: '8px 16px', background: isLoading || !input.trim() ? '#9ca3af' : '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}
        >
          Send
        </button>
      </div>
    </HTMLContainer>
  )
}

// 3. The Tldraw Shape Utility
export class BotShapeUtil extends ShapeUtil<IBotShape> {
  static override type = BOT_SHAPE_TYPE
  static override props: RecordProps<IBotShape> = {
    w: T.number,
    h: T.number,
  }

  getDefaultProps(): IBotShape['props'] {
    return { w: 350, h: 450 } // A good default size for a chat window
  }

  override canEdit() { return false }
  override canResize() { return true }
  override isAspectRatioLocked() { return false }

  getGeometry(shape: IBotShape): Geometry2d {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  override onResize(shape: any, info: TLResizeInfo<any>) {
    return resizeBox(shape, info)
  }

  component() {
    return <ChatbotUI />
  }

  indicator(shape: IBotShape) {
    return <rect width={shape.props.w} height={shape.props.h} />
  }
}

// 4. The Tldraw Tool (Allows dropping it on the canvas)
export class BotShapeTool extends BaseBoxShapeTool {
  static override id = 'bot-shape'
  static override initial = 'idle'
  override shapeType = BOT_SHAPE_TYPE as 'bot-shape'
}