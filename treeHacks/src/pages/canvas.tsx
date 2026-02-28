import { useRef } from 'react'
import { Tldraw, Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { CodeBlockUtil, CodeBlockTool } from '../shapes/CodeBlock'
import { getApiBaseUrl, getLogoutUrl } from '../lib/auth'

const customShapeUtils = [CodeBlockUtil]
const customTools = [CodeBlockTool]
const API_BASE_URL = getApiBaseUrl()

export default function CanvasPage() {

    async function fetchData(url: string) {
        try {
          const response = await fetch(url, {
            credentials: 'include',
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const data = await response.json();
          return data;
        } catch (error) {
          console.error('Fetch error:', error);
          return null;
        }
    }

    const editorRef = useRef<Editor | null>(null);

    const handleMount = (editor: Editor) => {
      editorRef.current = editor;

      // Load saved shapes from API
      const apiUrl = `${API_BASE_URL}/canvas/8d7fdf9b-1ece-4782-bbc3-5b68d9af6722/shapes`;
      fetchData(apiUrl).then(shapeData => {
        if (shapeData && shapeData.length > 0) {
          // Extract the tldraw shape data from each record
          const shapes = shapeData.map((s: { data: object }) => s.data);
          editor.createShapes(shapes);
        }
      });
    };

    const exportShapes = () => {
      if (!editorRef.current) return;

      // Get all shapes on current page
      const shapes = editorRef.current.getCurrentPageShapes();

      // Serialize to JSON
      const json = JSON.stringify(shapes, null, 2);

    const apiUrl = `${API_BASE_URL}/canvas/8d7fdf9b-1ece-4782-bbc3-5b68d9af6722/shapes`;
    fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: json,
    })
    .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        console.log('Shapes successfully saved:', data);
    })
    .catch(error => {
        console.error('Error saving shapes:', error);
    });
      console.log(json);
    };



    // on save, post TLShapes to API

    const selectCodeBlockTool = () => {
      editorRef.current?.setCurrentTool('code-block')
    }

    const signOut = () => {
      const returnTo = '/login'
      window.location.href = getLogoutUrl(returnTo)
    }

    return (
    <div style={{ position: 'fixed', inset: 0 }}>
        <Tldraw onMount={handleMount} shapeUtils={customShapeUtils} tools={customTools} />
        <div className='absolute top-4 right-4 z-50'>
          <button onClick={signOut} className='bg-slate-900 text-white px-4 py-2 rounded shadow'>Sign out</button>
        </div>
        <div className='absolute bottom-4 right-4 z-50 flex gap-2'>
          <button onClick={selectCodeBlockTool} className='bg-purple-500 text-white px-4 py-2 rounded shadow'>Code Block</button>
          <button onClick={exportShapes} className='bg-white px-4 py-2 text-black rounded shadow'>Save</button>
        </div>
    </div>
  )
}
