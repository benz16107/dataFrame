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
import { useState, useRef } from 'react';
import { Pyodide } from "../pyodide"; // Make sure this path points to your pyodide file!

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
        width: '100%',
        height: '100%',
        backgroundColor: '#1e1e1e', 
        borderRadius: '8px',
        overflow: 'hidden',
        pointerEvents: 'all', // Ensure users can click inside the shape
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)'
      }}
    >
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
          height: '35%', 
          minHeight: '80px', 
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
  }

  getDefaultProps(): ICustomShape['props'] {
    return {
      w: 400,
      h: 300,
      text: "print('Hello TreeHacks!')\n",
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
    return resizeBox(shape, info)
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