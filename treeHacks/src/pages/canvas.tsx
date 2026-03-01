import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
// 1. ADDED createShapeId to the tldraw imports
import { Tldraw, Editor, DefaultActionsMenu, DefaultQuickActions, DefaultStylePanel, TLComponents, TldrawOptions, TldrawUiToolbar, getSnapshot, useEditor, useValue, createShapeId } from "tldraw";
import "tldraw/tldraw.css";
import { CodeBlockUtil, CodeBlockTool } from "../shapes/CodeBlock";
// 2. ADDED BOT IMPORTS
import { BotShapeUtil, BotShapeTool } from '../shapes/bot'
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  clearPendingCanvasImport,
  loadCanvasBackground,
  loadPendingCanvasImport,
  saveCanvasBackground,
  saveCanvasPreview,
  touchCanvas,
  upsertCanvas,
} from "@/lib/canvasStore";
import { CanvasBackgroundPreset, parseCanvasImportPayload, toCanvasExportFileName } from "@/lib/canvasTransfer";
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

// 3. ADDED BOT TO ARRAYS
const customTools = [CodeBlockTool, BotShapeTool]
const shapeUtils = [CodeBlockUtil, NodeShapeUtil, ConnectionShapeUtil, BotShapeUtil]
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
    return (
      <div className="canvas-style-panel-anchor">
        <DefaultStylePanel />
      </div>
    )
  },
}

const options: Partial<TldrawOptions> = {
  actionShortcutsLocation: 'menu',
  maxPages: 1,
}

const backgroundOptions: Array<{ id: CanvasBackgroundPreset; label: string }> = [
  { id: "paper", label: "Paper" },
  { id: "sunset", label: "Sunset" },
  { id: "mint", label: "Mint" },
  { id: "midnight", label: "Midnight" },
  { id: "dots-slate", label: "Dots Slate" },
  { id: "dots-indigo", label: "Dots Indigo" },
  { id: "lines-sky", label: "Lines Sky" },
  { id: "lines-graph", label: "Lines Graph" },
];

export default function CanvasPage() {
  const AUTO_SAVE_STORAGE_KEY = "treehacks_canvas_auto_save_enabled"
  const saveFeedbackTimerRef = useRef<number | null>(null)
  const isSavingRef = useRef(false)
  const lastSavedShapesRef = useRef<string | null>(null)
  const importFileInputRef = useRef<HTMLInputElement | null>(null)
  const canvasPageRef = useRef<HTMLDivElement | null>(null)
  const zoomSyncRafRef = useRef<number | null>(null)

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
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error" | "autosaving" | "autosaved" | "autoerror">("idle");
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [backgroundPreset, setBackgroundPreset] = useState<CanvasBackgroundPreset>("paper");
  const [autoSaveEnabled, setAutoSaveEnabled] = useState<boolean>(() => {
    const stored = window.localStorage.getItem(AUTO_SAVE_STORAGE_KEY)
    if (stored === null) return true
    return stored === "true"
  })
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [isClearingCanvas, setIsClearingCanvas] = useState(false);

  const canvasId = searchParams.get("id");
  useEffect(() => {
    if (canvasId) {
      setActiveCanvasId(canvasId);
    }
  }, [canvasId]);

  useEffect(() => {
    if (!activeCanvasId) return;
    const stored = loadCanvasBackground(activeCanvasId) as CanvasBackgroundPreset | null;
    setBackgroundPreset(stored ?? "paper");
  }, [activeCanvasId]);

  useEffect(() => {
    window.localStorage.setItem(AUTO_SAVE_STORAGE_KEY, String(autoSaveEnabled))
  }, [autoSaveEnabled])

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
        const now = new Date().toISOString();
        upsertCanvas({
          id: data.id,
          name: data.name ?? "Untitled Canvas",
          updatedAt: now,
          createdAt: now,
          lastOpenedAt: now,
        });
        navigate(`/canvas?id=${data.id}`, { replace: true });
      }
    } catch (error) {
      console.error("Error creating canvas:", error);
    }
  };

  const updateCanvasPreview = useCallback(async (canvasIdForPreview: string) => {
    if (!editorRef.current) return;

    const shapes = editorRef.current.getCurrentPageShapes();
    if (shapes.length === 0) {
      saveCanvasPreview(canvasIdForPreview, null);
      return;
    }

    try {
      const image = await editorRef.current.toImageDataUrl(shapes, {
        format: "png",
        scale: 1,
      });
      saveCanvasPreview(canvasIdForPreview, image.url);
    } catch (error) {
      console.error("Error generating canvas preview:", error);
    }
  }, []);

  const loadShapes = (id: string) => {
    const pendingSnapshot = loadPendingCanvasImport(id)

    if (pendingSnapshot && editorRef.current) {
      try {
        editorRef.current.loadSnapshot(pendingSnapshot as any)
        const importedShapes = editorRef.current.getCurrentPageShapes()
        if (importedShapes.length === 0) {
          throw new Error('Imported snapshot loaded but contains no page shapes')
        }

        clearPendingCanvasImport(id)
        lastSavedShapesRef.current = JSON.stringify(importedShapes, null, 2)
        void persistShapes(id, true)
        return
      } catch (error) {
        console.error('Failed to apply pending canvas import:', error)
      }
    }

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
        lastSavedShapesRef.current = JSON.stringify(shapes, null, 2)
        void updateCanvasPreview(id)
      } else {
        editorRef.current.createShape({ type: 'node', x: 200, y: 200 });
        lastSavedShapesRef.current = null
        void updateCanvasPreview(id)
      }
    });
  };

  const handleMount = (editor: Editor) => {
    editorRef.current = editor;
    setActiveEditor(editor);
    if (canvasPageRef.current) {
      canvasPageRef.current.style.setProperty('--canvas-zoom', `${editor.getZoomLevel()}`)
    }
  };

  useEffect(() => {
    if (!activeCanvasId || !activeEditor) return;
    loadShapes(activeCanvasId);
  }, [activeCanvasId, activeEditor]);

  useEffect(() => {
    const editor = activeEditor
    const container = canvasPageRef.current
    if (!editor || !container) return

    let lastZoom = -1
    const updateZoomVariable = () => {
      const zoom = editor.getZoomLevel()
      if (Math.abs(zoom - lastZoom) > 0.01) {
        container.style.setProperty('--canvas-zoom', `${zoom}`)
        lastZoom = zoom
      }
      zoomSyncRafRef.current = window.requestAnimationFrame(updateZoomVariable)
    }

    zoomSyncRafRef.current = window.requestAnimationFrame(updateZoomVariable)

    return () => {
      if (zoomSyncRafRef.current !== null) {
        window.cancelAnimationFrame(zoomSyncRafRef.current)
        zoomSyncRafRef.current = null
      }
    }
    }, [activeCanvasId, activeEditor])

    useEffect(() => {
      if (!activeEditor) return
      const shouldUseDotGrid = backgroundPreset === "dots-slate" || backgroundPreset === "dots-indigo"
      activeEditor.updateInstanceState({ isGridMode: shouldUseDotGrid })
    }, [activeEditor, backgroundPreset])

  useEffect(() => {
    return () => {
      if (saveFeedbackTimerRef.current !== null) {
        window.clearTimeout(saveFeedbackTimerRef.current)
      }
    }
  }, [])

  const persistShapes = useCallback(async (canvasIdToSave: string, showFeedback: boolean) => {
    if (!editorRef.current || isSavingRef.current) return;

    const shapes = editorRef.current.getCurrentPageShapes();
    const json = JSON.stringify(shapes, null, 2);

    if (!showFeedback && lastSavedShapesRef.current === json) {
      return;
    }

    isSavingRef.current = true

    if (showFeedback) {
      setSaveState("saving")
      if (saveFeedbackTimerRef.current !== null) {
        window.clearTimeout(saveFeedbackTimerRef.current)
        saveFeedbackTimerRef.current = null
      }
    } else {
      setSaveState("autosaving")
    }

    try {
      const apiUrl = `${API_BASE}/canvas/${canvasIdToSave}/shapes`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: json,
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      await response.json()
      await updateCanvasPreview(canvasIdToSave)
      touchCanvas(canvasIdToSave)
      lastSavedShapesRef.current = json

      if (showFeedback) {
        setSaveState("saved")
        saveFeedbackTimerRef.current = window.setTimeout(() => {
          setSaveState("idle")
          saveFeedbackTimerRef.current = null
        }, 2000)
      } else {
        setSaveState("autosaved")
        saveFeedbackTimerRef.current = window.setTimeout(() => {
          setSaveState("idle")
          saveFeedbackTimerRef.current = null
        }, 1500)
      }
    } catch (error) {
      console.error("Error saving shapes:", error)
      if (showFeedback) {
        setSaveState("error")
        saveFeedbackTimerRef.current = window.setTimeout(() => {
          setSaveState("idle")
          saveFeedbackTimerRef.current = null
        }, 3000)
      } else {
        setSaveState("autoerror")
        saveFeedbackTimerRef.current = window.setTimeout(() => {
          setSaveState("idle")
          saveFeedbackTimerRef.current = null
        }, 3000)
      }
    } finally {
      isSavingRef.current = false
    }
  }, [updateCanvasPreview])

  const exportShapes = () => {
    if (!activeCanvasId) return
    void persistShapes(activeCanvasId, true)
  }

  const exportCanvasToFile = useCallback(() => {
    if (!editorRef.current) return

    const payload = {
      kind: "dataframe-canvas-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      sourceCanvasId: activeCanvasId,
      settings: {
        backgroundPreset,
      },
      tldrawSnapshot: getSnapshot(editorRef.current.store),
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = objectUrl
    anchor.download = toCanvasExportFileName(activeCanvasId)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(objectUrl)
  }, [activeCanvasId, backgroundPreset])

  const importCanvasFromFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !editorRef.current) return

    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown

      const { snapshot: snapshotToLoad, backgroundPreset: importedBackground } = parseCanvasImportPayload(parsed)

      editorRef.current.loadSnapshot(snapshotToLoad as any)

      if (importedBackground) {
        setBackgroundPreset(importedBackground)
        if (activeCanvasId) {
          saveCanvasBackground(activeCanvasId, importedBackground)
        }
      }

      if (activeCanvasId) {
        await persistShapes(activeCanvasId, true)
      }
    } catch (error) {
      console.error("Failed to import canvas file:", error)
      window.alert("Import failed. Please choose a valid canvas export JSON file.")
    } finally {
      event.target.value = ""
    }
  }, [activeCanvasId, persistShapes])

  const applyBackground = (preset: CanvasBackgroundPreset) => {
    setBackgroundPreset(preset);
    if (activeCanvasId) {
      saveCanvasBackground(activeCanvasId, preset);
    }
  };

  const openClearModal = () => {
    setIsClearModalOpen(true);
  };

  const closeClearModal = () => {
    if (isClearingCanvas) return;
    setIsClearModalOpen(false);
  };

  const clearEntireCanvas = async () => {
    if (!editorRef.current || !activeCanvasId) {
      setIsClearModalOpen(false);
      return;
    }

    setIsClearingCanvas(true);
    try {
      const shapeIds = editorRef.current.getCurrentPageShapes().map((shape) => shape.id);
      if (shapeIds.length > 0) {
        editorRef.current.deleteShapes(shapeIds);
      }

      lastSavedShapesRef.current = null;
      await persistShapes(activeCanvasId, true);
      setIsClearModalOpen(false);
    } finally {
      setIsClearingCanvas(false);
    }
  };

  useEffect(() => {
    if (!activeCanvasId || !autoSaveEnabled) return

    const intervalId = window.setInterval(() => {
      void persistShapes(activeCanvasId, false)
    }, 2500)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [activeCanvasId, persistShapes, autoSaveEnabled])

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
    <div className="canvas-page" data-bg={backgroundPreset} ref={canvasPageRef}>
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
          className="dash-btn dash-btn-outline"
        >
          Back to Dashboard
        </button>
      </div>
      <div className="canvas-top-right-actions">
        <input
          ref={importFileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={(event) => void importCanvasFromFile(event)}
          style={{ display: "none" }}
        />
        <button
          onClick={() => importFileInputRef.current?.click()}
          className="dash-btn dash-btn-outline"
        >
          Import File
        </button>
        <button
          onClick={exportCanvasToFile}
          className="dash-btn dash-btn-outline"
        >
          Export File
        </button>
        <button
          onClick={openClearModal}
          className="dash-btn dash-btn-outline"
        >
          Clear Canvas
        </button>

        {/* 4. THE MAGIC INSTANT-SPAWN BOT BUTTON */}
        <button 
          onClick={() => {
            if (editorRef.current) {
              editorRef.current.createShapes([{
                id: createShapeId(),
                type: 'bot-shape',
                x: window.innerWidth / 2 - 175,
                y: window.innerHeight / 2 - 225,
              }]);
              editorRef.current.setCurrentTool('select');
            }
          }} 
          className="dash-btn dash-btn-outline"
        >
          Add Bot
        </button>

        <button
          onClick={() => setIsOptionsOpen((open) => !open)}
          className="dash-btn dash-btn-outline"
          aria-expanded={isOptionsOpen}
          aria-haspopup="menu"
        >
          Options
        </button>
        <button
          onClick={exportShapes}
          className={`dash-btn ${
            !autoSaveEnabled && saveState !== "saved"
              ? "dash-btn-primary"
              : saveState === "idle" || saveState === "saved"
                ? "dash-btn-saved"
                : "dash-btn-primary"
          }`}
          disabled={saveState === "saving" || saveState === "autosaving"}
        >
          {!autoSaveEnabled
            ? saveState === "saving"
              ? "Saving..."
              : saveState === "saved"
                ? "Saved"
                : "Save"
            : saveState === "saving"
              ? "Saving..."
              : saveState === "autosaving"
                ? "Saving..."
                : saveState === "saved"
                  ? "Saved"
                  : saveState === "autosaved"
                    ? "Saving..."
                    : saveState === "error"
                      ? "Save failed"
                      : saveState === "autoerror"
                        ? "Auto-save failed"
                        : "Saved"}
        </button>
      </div>

      {isClearModalOpen ? (
        <div className="dash-modal-backdrop" onClick={closeClearModal}>
          <div className="dash-modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="dash-modal-title">Clear Canvas</h3>
            <p className="dash-modal-subtitle">
              Clear all nodes and connections from this canvas? This will save the canvas as empty.
            </p>
            <div className="dash-modal-actions">
              <button className="dash-btn dash-btn-ghost" onClick={closeClearModal} disabled={isClearingCanvas}>
                Cancel
              </button>
              <button
                className="dash-btn dash-btn-primary"
                onClick={() => void clearEntireCanvas()}
                disabled={isClearingCanvas}
              >
                {isClearingCanvas ? "Clearing..." : "Clear"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isOptionsOpen ? (
        <div className="canvas-options-panel" role="menu">
          <div className="canvas-options-section">
            <div className="canvas-options-title">Saving</div>
            <button
              className={`canvas-toggle ${autoSaveEnabled ? "is-on" : "is-off"}`}
              role="switch"
              aria-checked={autoSaveEnabled}
              onClick={() => setAutoSaveEnabled((enabled) => !enabled)}
            >
              <span>Auto-save</span>
              <span>{autoSaveEnabled ? "On" : "Off"}</span>
            </button>
          </div>

          <div className="canvas-options-divider" />
          <div className="canvas-options-title">Background</div>
          <div className="canvas-options-grid">
            {backgroundOptions.map((option) => (
              <button
                key={option.id}
                className={`canvas-bg-option ${backgroundPreset === option.id ? "is-active" : ""}`}
                onClick={() => applyBackground(option.id)}
                role="menuitemradio"
                aria-checked={backgroundPreset === option.id}
              >
                <span className={`canvas-bg-chip bg-${option.id}`} />
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}