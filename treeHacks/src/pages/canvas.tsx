import { useEffect, useRef, useState } from "react";
import { Tldraw, Editor, DefaultActionsMenu, DefaultQuickActions, DefaultStylePanel, TLComponents, TldrawOptions, TldrawUiToolbar, useEditor, useValue } from "tldraw";
import "tldraw/tldraw.css";
import { CodeBlockUtil, CodeBlockTool } from "../shapes/CodeBlock";
import { useNavigate, useSearchParams } from "react-router-dom";
import { touchCanvas, upsertCanvas } from "@/lib/canvasStore";
import { getApiBaseUrl, getLogoutUrl, logoutSession } from '../lib/auth'
const API_BASE = getApiBaseUrl();


import { OnCanvasComponentPicker } from '../components/OnCanvasComponentPicker.tsx'
import { WorkflowRegions } from '../components/WorkflowRegions.tsx'
import { overrides, WorkflowToolbar } from '../components/WorkflowToolbar.tsx'
import { ConnectionBindingUtil } from '../connection/ConnectionBindingUtil'
import { ConnectionShapeUtil } from '../connection/ConnectionShapeUtil'
import { keepConnectionsAtBottom } from '../connection/keepConnectionsAtBottom'
import { disableTransparency } from '../disableTransparency.tsx'
import { NodeShapeUtil } from '../nodes/NodeShapeUtil'
import { PointingPort } from '../ports/PointingPort'

const customTools = [CodeBlockTool]

// Define custom shape utilities that extend tldraw's shape system
const shapeUtils = [CodeBlockUtil, NodeShapeUtil, ConnectionShapeUtil]
// Define binding utilities that handle relationships between shapes
const bindingUtils = [ConnectionBindingUtil]

// Customize tldraw's UI components to add workflow-specific functionality
const components: TLComponents = {
	InFrontOfTheCanvas: () => (
		<>
			<OnCanvasComponentPicker />
			<WorkflowRegions />
		</>
	),
	Toolbar: () => (
		<>
			<WorkflowToolbar />
			<div className="tlui-main-toolbar tlui-main-toolbar--horizontal">
				<TldrawUiToolbar className="tlui-main-toolbar__tools" label="Actions">
					<DefaultQuickActions />
					<DefaultActionsMenu />
				</TldrawUiToolbar>
			</div>
		</>
	),

	MenuPanel: () => null,
	StylePanel: () => {
		const editor = useEditor()
		const shouldShowStylePanel = useValue(
			'shouldShowStylePanel',
			() => {
				return (
					!editor.isIn('select') ||
					editor.getSelectedShapes().some((s) => s.type !== 'node' && s.type !== 'connection')
				)
			},
			[editor]
		)
		if (!shouldShowStylePanel) return
		return <DefaultStylePanel />
	},
}

const options: Partial<TldrawOptions> = {
	actionShortcutsLocation: 'menu',
	maxPages: 1,
}

export default function CanvasPage() {
    const canvasIdRef = useRef<string | null>(null)

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

    async function ensureCanvasId() {
      if (canvasIdRef.current) return canvasIdRef.current

      const canvases = await fetchData(`${API_BASE}/canvas/`)
      if (Array.isArray(canvases) && canvases.length > 0 && canvases[0]?.id) {
        canvasIdRef.current = canvases[0].id
        return canvasIdRef.current
      }

      const createResponse = await fetch(`${API_BASE}/canvas/`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'My Canvas' }),
      })

      if (!createResponse.ok) {
        throw new Error(`Failed to create canvas: ${createResponse.status}`)
      }

      const createdCanvas = await createResponse.json()
      canvasIdRef.current = createdCanvas.id
      return canvasIdRef.current
    }

  const editorRef = useRef<Editor | null>(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(null);

  const canvasId = searchParams.get("id");
  useEffect(() => {
    if (canvasId) {
      setActiveCanvasId(canvasId);
    }
  }, [canvasId]);

  const createCanvas = async () => {
    try {
      const response = await fetch(`${API_BASE}/canvas/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled Canvas" }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `HTTP ${response.status}: ${errorText || "unknown error"}`
        );
      }
      const data = await response.json();
      if (data?.id) {
        upsertCanvas({
          id: data.id,
          name: data.name ?? "Untitled Canvas",
          updatedAt: new Date().toISOString(),
        });
        navigate(`/canvas?id=${data.id}`, { replace: true });
      }
    } catch (error) {
      console.error("Error creating canvas:", error);
    }
  };

  const loadShapes = (id: string) => {
    const apiUrl = `${API_BASE}/canvas/${id}/shapes`;
    fetchData(apiUrl).then((shapeData) => {
      if (!editorRef.current) return;
      if (shapeData && shapeData.length > 0) {
        const shapes = shapeData.map((s: { data: object }) => s.data);
        editorRef.current.createShapes(shapes);
      }
    });
  };

  const handleMount = (editor: Editor) => {
    editorRef.current = editor;
  };

  useEffect(() => {
    if (!activeCanvasId || !editorRef.current) return;
    loadShapes(activeCanvasId);
  }, [activeCanvasId]);

  const exportShapes = () => {
    if (!editorRef.current || !activeCanvasId) return;

    // Get all shapes on current page
    const shapes = editorRef.current.getCurrentPageShapes();

    // Serialize to JSON
    const json = JSON.stringify(shapes, null, 2);

    ensureCanvasId().then(canvasId => {
      const apiUrl = `${API_BASE}/canvas/${canvasId}/shapes`;
      return fetch(apiUrl, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: json,
      })
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        console.log("Shapes successfully saved:", data);
        touchCanvas(activeCanvasId);
      })
      .catch((error) => {
        console.error("Error saving shapes:", error);
      });
    console.log(json);
  };

  // on save, post TLShapes to API

  const selectCodeBlockTool = () => {
    editorRef.current?.setCurrentTool("code-block");
  };

    const signOut = async () => {
      try {
        await logoutSession()
      } catch (error) {
        console.error('Error signing out:', error)
        window.location.assign(getLogoutUrl('/dashboard'))
        return
      }

      navigate('/dashboard', { replace: true })
    }


  if (!activeCanvasId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-lg p-8 text-center max-w-md">
          <h2 className="text-2xl font-semibold text-slate-900">
            No canvas selected
          </h2>
          <p className="text-slate-600 mt-2">
            Create a new canvas to get started.
          </p>
          <button
            onClick={createCanvas}
            className="mt-6 bg-slate-900 text-white px-6 py-3 rounded-lg font-semibold"
          >
            Create Canvas
          </button>
        </div>
      </div>
    );
  }
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
        <Tldraw
            persistenceKey="workflow"
            options={options}
            overrides={overrides}
            shapeUtils={shapeUtils}
            tools={customTools}
            bindingUtils={bindingUtils}
            components={components}
            onMount={(editor) => {
                handleMount(editor);
                ;(window as any).editor = editor
                if (!editor.getCurrentPageShapes().some((s) => s.type === 'node')) {
                    editor.createShape({ type: 'node', x: 200, y: 200 })
                }

                editor.user.updateUserPreferences({ isSnapMode: true })

                // Add our custom pointing port tool to the select tool's state machine
                // This allows users to create connections by pointing at ports
                editor.getStateDescendant('select')!.addChild(PointingPort)

                // Ensure connections always stay at the bottom of the shape stack
                // This prevents them from covering other shapes
                keepConnectionsAtBottom(editor)

                // Disable transparency for workflow shapes
                disableTransparency(editor, ['node', 'connection'])
            }}
        />
                <div className='absolute top-4 right-4 z-50'>
          <button onClick={signOut} className='bg-slate-900 text-white px-4 py-2 rounded shadow'>Sign out</button>
        </div>
      <div className="absolute bottom-4 right-4 z-50 flex gap-2">
        <button
          onClick={() => navigate("/dashboard")}
          className="bg-slate-900 text-white px-4 py-2 rounded shadow"
        >
          Back to Dashboard
        </button>
        <button
          onClick={selectCodeBlockTool}
          className="bg-purple-500 text-white px-4 py-2 rounded shadow"
        >
          Code Block
        </button>
        <button
          onClick={exportShapes}
          className="bg-white px-4 py-2 text-black rounded shadow"
        >
          Save
        </button>
      </div>
    </div>
  )
}