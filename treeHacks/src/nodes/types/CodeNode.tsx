import { getIndexAbove, IndexKey, T, useEditor, useValue } from 'tldraw'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { useState, useCallback, MouseEvent, PointerEvent } from 'react'
import { Pyodide } from '@/pyodide'
import { getApiBaseUrl } from '../../lib/auth'
import { CodeIcon } from '../../components/icons/CodeIcon'
import {
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_BOTTOM_PADDING_PX,
	NODE_ROW_HEADER_GAP_PX,
	NODE_ROW_HEIGHT_PX,
	NODE_WIDTH_PX,
} from '../../constants'
import { Port, ShapePort } from '../../ports/Port'
import { indexList, indexListEntries, indexListLength } from '../../utils'
import { getNodeInputPortValues, getNodePortConnections } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import {
	areAnyInputsOutOfDate,
	ExecutionResult,
	InfoValues,
	InputValues,
	CopyTextButton,
	NodeComponentProps,
	NodeDefinition,
	NodeRow,
	PortValueDropdown,
	STOP_EXECUTION,
	updateNode,
} from './shared'

// Minimum height for the code editor area
const CODE_EDITOR_MIN_HEIGHT_PX = 150
// Height for the console output area
const CONSOLE_OUTPUT_HEIGHT_PX = 80
// Height for the AI assistant prompt panel
const CODE_AI_PANEL_HEIGHT_PX = 88

const API_BASE = getApiBaseUrl()

/**
 * The code node executes Python code. It has a variable number of inputs and outputs.
 *
 * The items in the node are stored in an index list - a list where the keys are fractional indexes,
 * to allow for elements to be inserted in the middle of the list, and to make sure the indexes of
 * other items don't change when items are removed.
 */
export type CodeNode = T.TypeOf<typeof CodeNode>
export const CodeNode = T.object({
	type: T.literal('code'),
	code: T.string,
	aiPrompt: T.string,
	inputs: T.dict(T.indexKey, T.any),
	outputs: T.dict(T.indexKey, T.any),
	lastResult: T.any.nullable(),
})

export class CodeNodeDefinition extends NodeDefinition<CodeNode> {
	static type = 'code'
	static validator = CodeNode
	title = 'Code'
	heading = 'Code'
	icon = (<CodeIcon />)

	getDefault(): CodeNode {
		return {
			type: 'code',
			code: '',
			aiPrompt: '',
			inputs: indexList([0]),
			outputs: indexList([null]),
			lastResult: null,
		}
	}

	// The height of the node is based on the number of input/output rows plus the code editor
	getBodyHeightPx(shape: NodeShape, node: CodeNode) {
		const inputRows = indexListLength(node.inputs)
		const outputRows = indexListLength(node.outputs)
		const maxRows = Math.max(inputRows, outputRows) + 1
		const baseBodyHeight =
			NODE_ROW_HEIGHT_PX * maxRows + CODE_AI_PANEL_HEIGHT_PX + CODE_EDITOR_MIN_HEIGHT_PX + CONSOLE_OUTPUT_HEIGHT_PX
		const overrideBodyHeight = Math.max(
			0,
			(shape.props.h || 0) - NODE_HEADER_HEIGHT_PX - NODE_ROW_HEADER_GAP_PX - NODE_ROW_BOTTOM_PADDING_PX
		)
		return Math.max(baseBodyHeight, overrideBodyHeight)
	}

	getPorts(shape: NodeShape, node: CodeNode): Record<string, ShapePort> {
		const ports: Record<string, ShapePort> = {}
		const nodeWidth = Math.max(NODE_WIDTH_PX, shape.props.w || NODE_WIDTH_PX)

		// Input ports on the left side
		Object.keys(node.inputs)
			.sort()
			.forEach((idx, i) => {
				ports[`input_${idx}`] = {
					id: `input_${idx}`,
					x: 0,
					y:
						NODE_HEADER_HEIGHT_PX +
						NODE_ROW_HEADER_GAP_PX +
						NODE_ROW_HEIGHT_PX * i +
						NODE_ROW_HEIGHT_PX / 2,
					terminal: 'end',
				}
			})

		// Output ports on the right side
		Object.keys(node.outputs)
			.sort()
			.forEach((idx, i) => {
				ports[`output_${idx}`] = {
					id: `output_${idx}`,
					x: nodeWidth,
					y:
						NODE_HEADER_HEIGHT_PX +
						NODE_ROW_HEADER_GAP_PX +
						NODE_ROW_HEIGHT_PX * i +
						NODE_ROW_HEIGHT_PX / 2,
					terminal: 'start',
				}
			})

		return ports
	}

	// Execute the Python code with inputs and capture the returned value
	async execute(shape: NodeShape, node: CodeNode, inputs: InputValues): Promise<ExecutionResult> {
		const pyodide = Pyodide.getInstance()

		// Build input variables: input, input2, input3...
		const pyInputs: Record<string, unknown> = {}
		const sortedInputKeys = Object.keys(node.inputs).sort()
		sortedInputKeys.forEach((idx, i) => {
			const portId = `input_${idx}`
			const value = inputs[portId] ?? node.inputs[idx as IndexKey] ?? null
			pyInputs[getInputVariableName(i)] = value
		})

		const sortedOutputKeys = Object.keys(node.outputs).sort()
		const outputNames = sortedOutputKeys.map((_idx, i) => getOutputVariableName(i))

		try {
			// Run the code and read named outputs (output, output2, ...)
			const namedResults = await pyodide.runWithIO(node.code, pyInputs, outputNames)

			const result: ExecutionResult = {}
			sortedOutputKeys.forEach((idx, i) => {
				const outputName = getOutputVariableName(i)
				result[`output_${idx}`] = namedResults[outputName] ?? null
			})

			const newOutputs: Record<IndexKey, unknown> = {}
			sortedOutputKeys.forEach((idx, i) => {
				const outputName = getOutputVariableName(i)
				newOutputs[idx as IndexKey] = namedResults[outputName] ?? null
			})

			const firstOutputName = getOutputVariableName(0)
			updateNode<CodeNode>(this.editor, shape, (n) => ({
				...n,
				outputs: newOutputs,
				lastResult: namedResults[firstOutputName] ?? null,
			}), false)

			return result
		} catch (error) {
			console.error('CodeNode execution error:', error)
			const result: ExecutionResult = {}
			sortedOutputKeys.forEach((idx) => {
				result[`output_${idx}`] = null
			})
			return result
		}
	}

	getOutputInfo(shape: NodeShape, node: CodeNode, inputs: InfoValues): InfoValues {
		const result: InfoValues = {}
		Object.keys(node.outputs).forEach((idx) => {
			result[`output_${idx}`] = {
				value: node.outputs[idx as IndexKey] ?? null,
				isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate,
			}
		})
		return result
	}

	Component = CodeNodeComponent
}

export function CodeNodeComponent({ shape, node }: NodeComponentProps<CodeNode>) {
	const editor = useEditor()
	const [output, setOutput] = useState<string | null>(null)
	const [isRunning, setIsRunning] = useState(false)
	const [isGenerating, setIsGenerating] = useState(false)
	const [aiError, setAiError] = useState<string | null>(null)
	const inputPortValues = useValue('code input port values', () => getNodeInputPortValues(editor, shape.id), [
		editor,
		shape.id,
	])
	const inputRows = indexListLength(node.inputs)
	const outputRows = indexListLength(node.outputs)
	const maxRows = Math.max(inputRows, outputRows) + 1
	const baseBodyHeight =
		NODE_ROW_HEIGHT_PX * maxRows + CODE_AI_PANEL_HEIGHT_PX + CODE_EDITOR_MIN_HEIGHT_PX + CONSOLE_OUTPUT_HEIGHT_PX
	const bodyHeight = Math.max(baseBodyHeight, shape.props.h || 0)
	const consoleHeight = Math.max(72, Math.min(140, Math.round(bodyHeight * 0.24)))
	const editorHeight = Math.max(
		120,
		bodyHeight - NODE_ROW_HEIGHT_PX * maxRows - CODE_AI_PANEL_HEIGHT_PX - consoleHeight
	)

	const onPointerDown = useCallback((event: PointerEvent) => {
		event.stopPropagation()
	}, [])

	const onPointerDownHandled = useCallback((event: PointerEvent) => {
		editor.markEventAsHandled(event)
		event.stopPropagation()
	}, [editor])

	const onWheel = useCallback((event: React.WheelEvent) => {
		event.stopPropagation()
	}, [])

	const handleCodeChange = (value: string) => {
		updateNode<CodeNode>(editor, shape, (node) => ({
			...node,
			code: value,
		}))
	}

	const handleAiPromptChange = (value: string) => {
		updateNode<CodeNode>(editor, shape, (current) => ({
			...current,
			aiPrompt: value,
		}), false)
	}

	const handleAddInput = () => {
		updateNode<CodeNode>(editor, shape, (current) => ({
			...current,
			inputs: appendCodeIoItem(current.inputs, null),
		}), false)
	}

	const handleAddOutput = () => {
		updateNode<CodeNode>(editor, shape, (current) => ({
			...current,
			outputs: appendCodeIoItem(current.outputs, null),
		}), false)
	}

	const handleRemoveInput = (idx: IndexKey) => {
		const entries = indexListEntries(node.inputs)
		if (entries.length <= 1) return
		if (idx === entries[0][0]) return

		const removedPortId = `input_${idx}`
		const connectionIds = getNodePortConnections(editor, shape.id)
			.filter((connection) => connection.ownPortId === removedPortId)
			.map((connection) => connection.connectionId)

		if (connectionIds.length > 0) {
			editor.deleteShapes(connectionIds)
		}

		updateNode<CodeNode>(editor, shape, (current) => {
			const nextInputs = { ...current.inputs }
			delete nextInputs[idx]
			return {
				...current,
				inputs: nextInputs,
			}
		}, false)
	}

	const handleRemoveOutput = (idx: IndexKey) => {
		const entries = indexListEntries(node.outputs)
		if (entries.length <= 1) return
		if (idx === entries[0][0]) return

		const removedPortId = `output_${idx}`
		const connectionIds = getNodePortConnections(editor, shape.id)
			.filter((connection) => connection.ownPortId === removedPortId)
			.map((connection) => connection.connectionId)

		if (connectionIds.length > 0) {
			editor.deleteShapes(connectionIds)
		}

		updateNode<CodeNode>(editor, shape, (current) => {
			const nextOutputs = { ...current.outputs }
			delete nextOutputs[idx]
			return {
				...current,
				outputs: nextOutputs,
			}
		}, false)
	}

	const handleAddInputClick = (event: MouseEvent<HTMLButtonElement>) => {
		event.preventDefault()
		event.stopPropagation()
		editor.markEventAsHandled(event)
		handleAddInput()
	}

	const handleAddOutputClick = (event: MouseEvent<HTMLButtonElement>) => {
		event.preventDefault()
		event.stopPropagation()
		editor.markEventAsHandled(event)
		handleAddOutput()
	}

	const handleRemoveInputClick = (idx: IndexKey) => (event: MouseEvent<HTMLButtonElement>) => {
		event.preventDefault()
		event.stopPropagation()
		editor.markEventAsHandled(event)
		handleRemoveInput(idx)
	}

	const handleRemoveOutputClick = (idx: IndexKey) => (event: MouseEvent<HTMLButtonElement>) => {
		event.preventDefault()
		event.stopPropagation()
		editor.markEventAsHandled(event)
		handleRemoveOutput(idx)
	}

	const executePython = async () => {
		setIsRunning(true)
		setOutput('')

		try {
			const pyodide = Pyodide.getInstance()

			pyodide.setOutput((text: string) => {
				setOutput((prev) => (prev ? prev + '\n' + text : text))
			})

			// Get input values from connected nodes
			const inputPortValues = getNodeInputPortValues(editor, shape.id)

			// Build input variables: input, input2, input3...
			const pyInputs: Record<string, unknown> = {}
			const sortedInputKeys = Object.keys(node.inputs).sort()
			sortedInputKeys.forEach((idx, i) => {
				const portId = `input_${idx}`
				const portValue = inputPortValues[portId]
				const value = portValue?.value ?? node.inputs[idx as IndexKey] ?? null
				pyInputs[getInputVariableName(i)] = value
			})

			const sortedOutputKeys = Object.keys(node.outputs).sort()
			const outputNames = sortedOutputKeys.map((_idx, i) => getOutputVariableName(i))
			const namedResults = await pyodide.runWithIO(node.code, pyInputs, outputNames)

			const newOutputs: Record<IndexKey, unknown> = {}
			sortedOutputKeys.forEach((idx, i) => {
				const outputName = getOutputVariableName(i)
				newOutputs[idx as IndexKey] = namedResults[outputName] ?? null
			})

			const firstOutputName = getOutputVariableName(0)
			updateNode<CodeNode>(editor, shape, (n) => ({
				...n,
				outputs: newOutputs,
				lastResult: namedResults[firstOutputName] ?? null,
			}), false)
		} catch (error) {
			setOutput(String(error))
		} finally {
			setIsRunning(false)
		}
	}

	const generateCodeWithGemini = async () => {
		if (isGenerating) return

		const prompt = node.aiPrompt.trim()
		if (!prompt) {
			setAiError('Add a prompt for code generation first.')
			return
		}

		setIsGenerating(true)
		setAiError(null)

		try {
			const inputNames = indexListEntries(node.inputs).map((_, i) => getInputVariableName(i))
			const outputNames = indexListEntries(node.outputs).map((_, i) => getOutputVariableName(i))

			const generationMessage = [
				'You are generating Python code for a workflow code node.',
				'Return only valid Python code. No markdown. No code fences. No prose.',
				`Available input variables: ${inputNames.join(', ') || '(none)'}`,
				`Expected output variables to assign: ${outputNames.join(', ') || '(none)'}`,
				node.code.trim() ? `Existing code to improve:\n${node.code}` : '',
				`Task:\n${prompt}`,
			].filter(Boolean).join('\n\n')

			const response = await fetch(`${API_BASE}/api/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ message: generationMessage }),
			})

			if (!response.ok) {
				let detail = `HTTP ${response.status}`
				try {
					const payload = (await response.json()) as { detail?: string }
					if (payload.detail) detail = payload.detail
				} catch {
					// keep default detail
				}
				throw new Error(detail)
			}

			const data = (await response.json()) as { reply?: string; output?: unknown }
			const raw =
				typeof data.reply === 'string'
					? data.reply
					: typeof data.output === 'string'
						? data.output
						: typeof data.output === 'object' && data.output !== null
							? JSON.stringify(data.output, null, 2)
							: ''

			const generatedCode = extractPythonCode(raw)
			if (!generatedCode.trim()) {
				throw new Error('Gemini returned empty code.')
			}

			updateNode<CodeNode>(editor, shape, (current) => ({
				...current,
				code: generatedCode,
			}), false)
		} catch (error) {
			setAiError(error instanceof Error ? error.message : 'Failed to generate code.')
		} finally {
			setIsGenerating(false)
		}
	}

	return (
		<div className="CodeNode">
			{/* Input/Output Ports Row */}
			<div className="CodeNode-ports">
				<div className="CodeNode-inputs">
					{indexListEntries(node.inputs).map(([idx], rowIndex) => {
						const isFirst = rowIndex === 0
						const inputPortId = `input_${idx}`
						const connectedInput = inputPortValues[inputPortId]
						const previewInputValue =
							connectedInput?.value === STOP_EXECUTION
								? STOP_EXECUTION
								: connectedInput?.value ?? node.inputs[idx as IndexKey] ?? null
						return (
						<NodeRow key={idx} className="CodeNode-port-row">
							<Port shapeId={shape.id} portId={`input_${idx}`} />
							<span className="CodeNode-port-label">{getInputDisplayName(rowIndex)}</span>
							<PortValueDropdown
								title={`${getInputDisplayName(rowIndex)} value`}
								value={previewInputValue}
							/>
							{!isFirst && (
								<button
									type="button"
									className="CodeNode-inline-remove"
									title="Remove input"
									onPointerDown={onPointerDownHandled}
									onClick={handleRemoveInputClick(idx)}
									disabled={indexListLength(node.inputs) <= 1}
								>
									×
								</button>
							)}
						</NodeRow>
						)
					})}
					<NodeRow className="CodeNode-port-row CodeNode-port-row--control">
						<button
							type="button"
							className="CodeNode-add-io-button"
							onPointerDown={onPointerDownHandled}
							onClick={handleAddInputClick}
						>
							+ Add input
						</button>
					</NodeRow>
				</div>
				<div className="CodeNode-outputs">
					{indexListEntries(node.outputs).map(([idx], rowIndex) => {
						const isFirst = rowIndex === 0
						const previewOutputValue = node.outputs[idx as IndexKey] ?? null
						return (
						<NodeRow key={idx} className="CodeNode-port-row CodeNode-port-row--output">
							{!isFirst && (
								<button
									type="button"
									className="CodeNode-inline-remove"
									title="Remove output"
									onPointerDown={onPointerDownHandled}
									onClick={handleRemoveOutputClick(idx)}
									disabled={indexListLength(node.outputs) <= 1}
								>
									×
								</button>
							)}
							<PortValueDropdown
								title={`${getOutputDisplayName(rowIndex)} value`}
								value={previewOutputValue}
								align="right"
							/>
							<span className="CodeNode-port-label">{getOutputDisplayName(rowIndex)}</span>
							<Port shapeId={shape.id} portId={`output_${idx}`} />
						</NodeRow>
						)
					})}
					<NodeRow className="CodeNode-port-row CodeNode-port-row--output CodeNode-port-row--control">
						<button
							type="button"
							className="CodeNode-add-io-button"
							onPointerDown={onPointerDownHandled}
							onClick={handleAddOutputClick}
						>
							+ Add output
						</button>
					</NodeRow>
				</div>
			</div>

			<div
				className="CodeNode-ai-assist"
				style={{ pointerEvents: 'all' }}
				onPointerDown={onPointerDown}
			>
				<div className="CodeNode-ai-header">
					<span>Gemini Assist</span>
					<button
						type="button"
						className="CodeNode-generate-button"
						onPointerDown={onPointerDown}
						onClick={() => void generateCodeWithGemini()}
						disabled={isGenerating}
					>
						{isGenerating ? 'Generating...' : 'Generate'}
					</button>
				</div>
				<textarea
					className="CodeNode-ai-prompt"
					value={node.aiPrompt}
					onChange={(event) => handleAiPromptChange(event.target.value)}
					placeholder="Prompt Gemini to generate or refactor this code..."
					onPointerDown={onPointerDown}
					onFocus={() => editor.setSelectedShapes([shape.id])}
				/>
				{aiError ? <div className="CodeNode-ai-error">{aiError}</div> : null}
			</div>

			{/* Code Editor */}
			<div
				className="CodeNode-editor"
				style={{ pointerEvents: 'all' }}
				onKeyDown={(e) => e.stopPropagation()}
				onWheelCapture={onWheel}
			>
				<div className="CodeNode-editor-header">
					<span>python</span>
					<div className="CodeNode-header-actions">
						<CopyTextButton
							title="Copy code"
							getText={() => node.code}
							className="CodeNode-copy-button"
						/>
						<button
							onClick={() => setOutput(null)}
							disabled={!output}
							className="CodeNode-clear-button"
							onPointerDown={onPointerDown}
						>
							Clear
						</button>
						<button
							onClick={executePython}
							disabled={isRunning}
							className="CodeNode-run-button"
							onPointerDown={onPointerDown}
						>
							{isRunning ? 'Running...' : 'Run'}
						</button>
					</div>
				</div>
				<CodeMirror
					value={node.code}
					height={`${editorHeight}px`}
					theme="light"
					extensions={[python()]}
					onChange={handleCodeChange}
					onWheelCapture={onWheel}
					style={{ fontSize: '12px', pointerEvents: 'all' }}
				/>
			</div>

			{/* Console Output */}
			<div
				className="CodeNode-console"
				style={{
					pointerEvents: 'all',
					height: `${consoleHeight}px`,
					maxHeight: `${consoleHeight}px`,
					minHeight: `${consoleHeight}px`,
				}}
				onWheelCapture={onWheel}
			>
				<div className="CodeNode-console-header">
					<span>Console</span>
					<CopyTextButton
						title="Copy console output"
						getText={() => output ?? ''}
						className="CodeNode-copy-button"
						disabled={!output}
					/>
				</div>
				{output && <pre className="CodeNode-console-output">{output}</pre>}
			</div>
		</div>
	)
}

function appendCodeIoItem(items: Record<IndexKey, unknown>, value: unknown) {
	const entries = indexListEntries(items)
	if (entries.length === 0) {
		return indexList([value])
	}
	const lastIndex = entries[entries.length - 1]?.[0]
	const newIndex = getIndexAbove(lastIndex!)
	return {
		...items,
		[newIndex]: value,
	}
}

function getInputDisplayName(index: number): string {
	return index === 0 ? 'input' : `input${index + 1}`
}

function getOutputDisplayName(index: number): string {
	return index === 0 ? 'output' : `output${index + 1}`
}

function getInputVariableName(index: number): string {
	return index === 0 ? 'input' : `input${index + 1}`
}

function getOutputVariableName(index: number): string {
	return index === 0 ? 'output' : `output${index + 1}`
}

function extractPythonCode(text: string): string {
	const trimmed = text.trim()
	if (!trimmed) return ''

	if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
		const lines = trimmed.split(/\r?\n/)
		if (lines.length >= 2) {
			return lines.slice(1, -1).join('\n').trim()
		}
	}

	return trimmed
}
