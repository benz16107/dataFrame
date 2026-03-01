/* eslint-disable react-refresh/only-export-components */
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  resizeBox,
  BaseBoxShapeTool,
  useEditor,
} from 'tldraw'
import type { Geometry2d, RecordProps, TLResizeInfo, TLShape } from 'tldraw'
import CodeMirror from '@uiw/react-codemirror'                                                                                                                                                                          
import { python } from '@codemirror/lang-python'
import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Pyodide } from '@/pyodide'

const CODE_BLOCK_SHAPE = 'code-block-shape'

// [1] Define the shape's properties in Tldraw's global type system
declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    [CODE_BLOCK_SHAPE]: { w: number; h: number; text: string, inputs: Array<string>, outputs: Array<string> }
  }
}

// [2] Define the custom shape type
type ICustomShape = TLShape<typeof CODE_BLOCK_SHAPE>

// [3] The React component that renders inside the shape
function CodeBlockComponent({ shape }: { shape: ICustomShape }) {
  const editor = useEditor()
  const MIN_WIDTH = 260
  const MIN_HEIGHT = 180
  const consoleHeightPx = Math.max(56, Math.round(shape.props.h * 0.28))
  
  // Local state to hold the output and loading status for THIS specific block
  const [output, setOutput] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // Update the actual Tldraw shape when the user types
  const handleCodeChange = (value: string) => {
    editor.updateShape<ICustomShape>({
      id: shape.id,
      type: CODE_BLOCK_SHAPE,
      props: { text: value },
    })
  }

  const beginEdgeResize = (
    edge: 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    event.preventDefault()
    event.stopPropagation()

    editor.setSelectedShapes([shape.id])

    const startClientX = event.clientX
    const startClientY = event.clientY
    const startW = shape.props.w
    const startH = shape.props.h
    const startX = shape.x
    const startY = shape.y

    const onMove = (moveEvent: PointerEvent) => {
      const zoom = typeof editor.getZoomLevel === 'function' ? editor.getZoomLevel() : 1
      const deltaX = (moveEvent.clientX - startClientX) / zoom
      const deltaY = (moveEvent.clientY - startClientY) / zoom

      let nextW = startW
      let nextH = startH
      let nextX = startX
      let nextY = startY

      if (edge === 'right' || edge === 'top-right' || edge === 'bottom-right') {
        nextW = Math.max(MIN_WIDTH, startW + deltaX)
      }

      if (edge === 'left' || edge === 'top-left' || edge === 'bottom-left') {
        nextW = Math.max(MIN_WIDTH, startW - deltaX)
        nextX = startX + (startW - nextW)
      }

      if (edge === 'bottom' || edge === 'bottom-left' || edge === 'bottom-right') {
        nextH = Math.max(MIN_HEIGHT, startH + deltaY)
      }

      if (edge === 'top' || edge === 'top-left' || edge === 'top-right') {
        nextH = Math.max(MIN_HEIGHT, startH - deltaY)
        nextY = startY + (startH - nextH)
      }

      editor.updateShape<ICustomShape>({
        id: shape.id,
        type: CODE_BLOCK_SHAPE,
        x: nextX,
        y: nextY,
        props: {
          w: nextW,
          h: nextH,
        },
      })
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Fire the code to your custom Pyodide engine
 const executePython = async () => {
    setIsRunning(true);
    setOutput(""); // 1. Clear the old output from the last time they clicked run!
    
    try {
      const pyodide = Pyodide.getInstance(); 
      
      // 2. Append new print statements to the console instead of overwriting
      pyodide.setOutput((text: string) => {
        setOutput((prev) => (prev ? prev + '\n' + text : text));
      });

      // 3. Run the code
      await pyodide.run(shape.props.text);
    } catch (error) {
      setOutput(String(error)); 
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <HTMLContainer 
      style={{ 
        display: 'flex', 
        flexDirection: 'column',
        width: `${shape.props.w}px`,
        height: `${shape.props.h}px`,
        position: 'relative',
        backgroundColor: '#1e1e1e', 
        borderRadius: '8px',
        overflow: 'hidden',
        pointerEvents: 'all', // Ensure users can click inside the shape
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)'
      }}
      onPointerDownCapture={() => {
        editor.setSelectedShapes([shape.id])
      }}
    >
      <div
        onPointerDown={(event) => beginEdgeResize('top', event)}
        style={{
          position: 'absolute',
          top: 0,
          left: 10,
          right: 10,
          height: 12,
          cursor: 'ns-resize',
          zIndex: 40,
          borderTop: '2px solid rgba(148, 163, 184, 0.7)',
        }}
      />
      <div
        onPointerDown={(event) => beginEdgeResize('right', event)}
        style={{
          position: 'absolute',
          top: 10,
          right: 0,
          bottom: 10,
          width: 12,
          cursor: 'ew-resize',
          zIndex: 40,
          borderRight: '2px solid rgba(148, 163, 184, 0.7)',
        }}
      />
      <div
        onPointerDown={(event) => beginEdgeResize('bottom', event)}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 10,
          right: 10,
          height: 12,
          cursor: 'ns-resize',
          zIndex: 40,
          borderBottom: '2px solid rgba(148, 163, 184, 0.7)',
        }}
      />
      <div
        onPointerDown={(event) => beginEdgeResize('left', event)}
        style={{
          position: 'absolute',
          top: 10,
          left: 0,
          bottom: 10,
          width: 12,
          cursor: 'ew-resize',
          zIndex: 40,
          borderLeft: '2px solid rgba(148, 163, 184, 0.7)',
        }}
      />
      <div
        onPointerDown={(event) => beginEdgeResize('top-left', event)}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 16,
          height: 16,
          cursor: 'nwse-resize',
          zIndex: 45,
          background: 'rgba(148, 163, 184, 0.9)',
          borderRadius: '4px',
        }}
      />
      <div
        onPointerDown={(event) => beginEdgeResize('top-right', event)}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 16,
          height: 16,
          cursor: 'nesw-resize',
          zIndex: 45,
          background: 'rgba(148, 163, 184, 0.9)',
          borderRadius: '4px',
        }}
      />
      <div
        onPointerDown={(event) => beginEdgeResize('bottom-left', event)}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: 16,
          height: 16,
          cursor: 'nesw-resize',
          zIndex: 45,
          background: 'rgba(148, 163, 184, 0.9)',
          borderRadius: '4px',
        }}
      />
      <div
        onPointerDown={(event) => beginEdgeResize('bottom-right', event)}
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 16,
          height: 16,
          cursor: 'nwse-resize',
          zIndex: 45,
          background: 'rgba(148, 163, 184, 0.9)',
          borderRadius: '4px',
        }}
      />

      {/* HEADER & RUN BUTTON */}
      <div 
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 12px', backgroundColor: '#2d2d2d', borderBottom: '1px solid #444' }}
        onPointerDown={(e) => e.stopPropagation()} // Prevent dragging when clicking the button
      >
        <span style={{ color: '#aaa', fontSize: '12px', fontFamily: 'monospace' }}>python_script.py</span>
        <button
          onClick={executePython}
          disabled={isRunning}
          style={{
            backgroundColor: isRunning ? '#555' : '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            padding: '4px 12px',
            fontSize: '12px',
            cursor: isRunning ? 'not-allowed' : 'pointer',
            fontWeight: 'bold'
          }}
        >
          {isRunning ? 'Running...' : 'Run ▶'}
        </button>
      </div>

      {/* CODE EDITOR */}
      <div 
        style={{ flexGrow: 1, overflow: 'auto' }}
        onPointerDown={(e) => e.stopPropagation()} // Prevent Tldraw from dragging the shape when highlighting text
        onKeyDown={(e) => e.stopPropagation()}     // Prevent Tldraw from hijacking backspace/delete keys
      >
        <CodeMirror
          value={shape.props.text}
          height="100%"
          theme="dark"
          extensions={[python()]}                                                                                                                                                                          
          onChange={handleCodeChange}
          style={{ fontSize: '14px' }}
        />
      </div>

      {/* CONSOLE OUTPUT */}
      <div 
        style={{ 
          height: `${consoleHeightPx}px`, 
          backgroundColor: '#000', 
          color: '#fff', 
          padding: '8px', 
          overflowY: 'auto', 
          borderTop: '2px solid #333', 
          fontFamily: 'monospace', 
          fontSize: '13px' 
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div style={{ color: '#666', marginBottom: '4px', fontSize: '11px', textTransform: 'uppercase' }}>Console Output</div>
        {output && <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{output}</pre>}
      </div>
    </HTMLContainer>
  )
}

// [4] Shape Utility - Tells Tldraw how to handle the shape
export class CodeBlockUtil extends ShapeUtil<ICustomShape> {
  static override type = CODE_BLOCK_SHAPE
  static override props: RecordProps<ICustomShape> = {
    w: T.number,
    h: T.number,
    text: T.string,
    inputs: T.arrayOf(T.string),
    outputs: T.arrayOf(T.string),
  }

  getDefaultProps(): ICustomShape['props'] {
    return {
      w: 400,
      h: 300,
      text: "print('Hello TreeHacks!')\n",
      inputs: [],
      outputs: [],
    }
  }

  override canEdit() { return false }
  override canResize() { return true }
  override isAspectRatioLocked() { return false }

  getGeometry(shape: ICustomShape): Geometry2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override onResize(shape: any, info: TLResizeInfo<any>) {
    const resized = resizeBox(shape, info) as ICustomShape
    return {
      ...resized,
      props: {
        ...resized.props,
        w: Math.max(260, resized.props.w),
        h: Math.max(180, resized.props.h),
      },
    }
  }

  component(shape: ICustomShape) {
    return <CodeBlockComponent shape={shape} />
  }

  indicator(shape: ICustomShape) {
    return <rect width={shape.props.w} height={shape.props.h} />
  }
}

// [5] Tool - Allows the user to create the shape on the canvas
export class CodeBlockTool extends BaseBoxShapeTool {
  static override id = 'code-block'
  static override initial = 'idle'
  override shapeType = CODE_BLOCK_SHAPE as 'code-block-shape'
}