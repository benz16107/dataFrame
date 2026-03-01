import { useEffect, useRef, useState } from "react";
import { Tldraw, Editor, DefaultActionsMenu, DefaultQuickActions, DefaultStylePanel, TLComponents, TldrawOptions, TldrawUiToolbar, useEditor, useValue } from "tldraw";
import "tldraw/tldraw.css";
import { CodeBlockUtil, CodeBlockTool } from "../shapes/CodeBlock";
import { useNavigate, useSearchParams } from "react-router-dom";
import { touchCanvas, upsertCanvas } from "@/lib/canvasStore";
import { getApiBaseUrl } from '../lib/auth'
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
  const saveFeedbackTimerRef = useRef<number | null>(null)

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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

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

      const existingShapeIds = editorRef.current.getCurrentPageShapes().map((shape) => shape.id);
      if (existingShapeIds.length > 0) {
        editorRef.current.deleteShapes(existingShapeIds);
      }

      if (shapeData && shapeData.length > 0) {
        const shapes = shapeData.map((s: { data: object }) => s.data);
        editorRef.current.createShapes(shapes);
      } else {
        editorRef.current.createShape({ type: 'node', x: 200, y: 200 });
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

  useEffect(() => {
    return () => {
      if (saveFeedbackTimerRef.current !== null) {
        window.clearTimeout(saveFeedbackTimerRef.current)
      }
    }
  }, [])

  const exportShapes = () => {
    if (!editorRef.current || !activeCanvasId) return;
    setSaveState("saving")

    if (saveFeedbackTimerRef.current !== null) {
      window.clearTimeout(saveFeedbackTimerRef.current)
      saveFeedbackTimerRef.current = null
    }

    // Get all shapes on current page
    const shapes = editorRef.current.getCurrentPageShapes();

    // Serialize to JSON
    const json = JSON.stringify(shapes, null, 2);

    const apiUrl = `${API_BASE}/canvas/${activeCanvasId}/shapes`;
    fetch(apiUrl, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: json,
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
        setSaveState("saved")
        saveFeedbackTimerRef.current = window.setTimeout(() => {
          setSaveState("idle")
          saveFeedbackTimerRef.current = null
        }, 2000)
      })
      .catch((error) => {
        console.error("Error saving shapes:", error);
        setSaveState("error")
        saveFeedbackTimerRef.current = window.setTimeout(() => {
          setSaveState("idle")
          saveFeedbackTimerRef.current = null
        }, 3000)
      });
    console.log(json);
  };

  // on save, post TLShapes to API

  if (!activeCanvasId) {
    return (
      <div className="app-shell">
        <div className="app-card app-card-sm app-center">
          <h2 className="app-title">No canvas selected</h2>
          <p className="app-subtitle">Create a new canvas to get started.</p>
          <button
            onClick={createCanvas}
            className="dash-btn dash-btn-primary"
          >
            Create Canvas
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="canvas-page">
        <Tldraw
          key={activeCanvasId}
          persistenceKey={`workflow-${activeCanvasId}`}
            options={options}
            overrides={overrides}
            shapeUtils={shapeUtils}
            tools={customTools}
            bindingUtils={bindingUtils}
            components={components}
            onMount={(editor) => {
                handleMount(editor);
                ;(window as any).editor = editor

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
      <div className="canvas-top-left-actions">
        <button
          onClick={() => navigate("/dashboard")}
          className="dash-btn dash-btn-ghost"
        >
          Back to Dashboard
        </button>
      </div>
      <div className="canvas-top-right-actions">
        <button
          onClick={exportShapes}
          className="dash-btn dash-btn-primary"
          disabled={saveState === "saving"}
        >
          {saveState === "saving"
            ? "Saving..."
            : saveState === "saved"
              ? "Saved"
              : saveState === "error"
                ? "Save failed"
                : "Save"}
        </button>
      </div>
    </div>
  )
}