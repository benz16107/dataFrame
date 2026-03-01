import { Editor, getIndexAbove, getIndicesBetween, IndexKey, T, useEditor } from 'tldraw'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { useState, useCallback, PointerEvent } from 'react'
import { Pyodide } from '@/pyodide'
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
	NodeComponentProps,
	NodeDefinition,
	NodeRow,
	updateNode,
} from './shared'

// Minimum height for the code editor area
const CODE_EDITOR_MIN_HEIGHT_PX = 150
// Height for the console output area
const CONSOLE_OUTPUT_HEIGHT_PX = 80

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
			code: "",
			inputs: indexList([0]),
			outputs: indexList([0]),
			lastResult: null,
		}
	}

	// The height of the node is based on the number of input/output rows plus the code editor
	getBodyHeightPx(shape: NodeShape, node: CodeNode) {
		const inputRows = indexListLength(node.inputs)
		const outputRows = indexListLength(node.outputs)
		const maxRows = Math.max(inputRows, outputRows)
		const baseBodyHeight = NODE_ROW_HEIGHT_PX * maxRows + CODE_EDITOR_MIN_HEIGHT_PX + CONSOLE_OUTPUT_HEIGHT_PX
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

		// Build input variables: in_0, in_1, etc. (supports any value type)
		const pyInputs: Record<string, unknown> = {}
		const sortedInputKeys = Object.keys(node.inputs).sort()
		sortedInputKeys.forEach((idx, i) => {
			const portId = `input_${idx}`
			const value = inputs[portId] ?? node.inputs[idx as IndexKey] ?? null
			pyInputs[`in_${i}`] = value
		})

		const sortedOutputKeys = Object.keys(node.outputs).sort()

		try {
			// Run the code and get the returned value (can be any type including DataFrame)
			const returnValue = await pyodide.runWithIO(node.code, pyInputs)

			// Map the return value to outputs - first output gets the value
			const result: ExecutionResult = {}
			sortedOutputKeys.forEach((idx, i) => {
				result[`output_${idx}`] = i === 0 ? returnValue : null
			})

			// Update the node's stored outputs
			const newOutputs: Record<IndexKey, unknown> = {}
			sortedOutputKeys.forEach((idx, i) => {
				newOutputs[idx as IndexKey] = i === 0 ? returnValue : null
			})

			updateNode<CodeNode>(this.editor, shape, (n) => ({
				...n,
				outputs: newOutputs,
				lastResult: returnValue,
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

	// When a port is connected, ensure there's a spare empty port at the end
	onPortConnect(shape: NodeShape, _node: CodeNode, portId: string): void {
		if (portId.startsWith('input_')) {
			const idx = portId.slice(6) as IndexKey
			updateNode<CodeNode>(this.editor, shape, (node) => ({
				...node,
				inputs: ensureFinalEmptyItem(
					this.editor,
					shape,
					{ ...node.inputs, [idx]: node.inputs[idx] ?? 0 },
					'input',
					{ removeUnused: true }
				),
			}))
		} else if (portId.startsWith('output_')) {
			const idx = portId.slice(7) as IndexKey
			updateNode<CodeNode>(this.editor, shape, (node) => ({
				...node,
				outputs: ensureFinalEmptyItem(
					this.editor,
					shape,
					{ ...node.outputs, [idx]: node.outputs[idx] ?? 0 },
					'output',
					{ removeUnused: true }
				),
			}))
		}
	}

	// When a port is disconnected, clean up unused items
	onPortDisconnect(shape: NodeShape, _node: CodeNode, portId: string): void {
		if (portId.startsWith('input_')) {
			updateNode<CodeNode>(this.editor, shape, (node) => ({
				...node,
				inputs: ensureFinalEmptyItem(this.editor, shape, node.inputs, 'input', { removeUnused: true }),
			}))
		} else if (portId.startsWith('output_')) {
			updateNode<CodeNode>(this.editor, shape, (node) => ({
				...node,
				outputs: ensureFinalEmptyItem(this.editor, shape, node.outputs, 'output', { removeUnused: true }),
			}))
		}
	}

	Component = CodeNodeComponent
}

export function CodeNodeComponent({ shape, node }: NodeComponentProps<CodeNode>) {
	const editor = useEditor()
	const [output, setOutput] = useState<string | null>(null)
	const [isRunning, setIsRunning] = useState(false)
	const inputRows = indexListLength(node.inputs)
	const outputRows = indexListLength(node.outputs)
	const maxRows = Math.max(inputRows, outputRows)
	const baseBodyHeight = NODE_ROW_HEIGHT_PX * maxRows + CODE_EDITOR_MIN_HEIGHT_PX + CONSOLE_OUTPUT_HEIGHT_PX
	const bodyHeight = Math.max(baseBodyHeight, shape.props.h || 0)
	const consoleHeight = Math.max(72, Math.min(140, Math.round(bodyHeight * 0.24)))
	const editorHeight = Math.max(120, bodyHeight - NODE_ROW_HEIGHT_PX * maxRows - consoleHeight)

	const onPointerDown = useCallback((event: PointerEvent) => {
		event.stopPropagation()
	}, [])

	const handleCodeChange = (value: string) => {
		updateNode<CodeNode>(editor, shape, (node) => ({
			...node,
			code: value,
		}))
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

			// Build input variables: in_0, in_1, etc. (supports any value type)
			const pyInputs: Record<string, unknown> = {}
			const sortedInputKeys = Object.keys(node.inputs).sort()
			sortedInputKeys.forEach((idx, i) => {
				const portId = `input_${idx}`
				const portValue = inputPortValues[portId]
				const value = portValue?.value ?? node.inputs[idx as IndexKey] ?? null
				pyInputs[`in_${i}`] = value
			})

			// Run with inputs (result can be any type including DataFrame)
			const result = await pyodide.runWithIO(node.code, pyInputs)

			// Update node outputs with the result
			const sortedOutputKeys = Object.keys(node.outputs).sort()
			const newOutputs: Record<IndexKey, unknown> = {}
			sortedOutputKeys.forEach((idx, i) => {
				newOutputs[idx as IndexKey] = i === 0 ? result : null
			})

			updateNode<CodeNode>(editor, shape, (n) => ({
				...n,
				outputs: newOutputs,
				lastResult: result,
			}), false)
		} catch (error) {
			setOutput(String(error))
		} finally {
			setIsRunning(false)
		}
	}

	return (
		<div className="CodeNode">
			{/* Input/Output Ports Row */}
			<div className="CodeNode-ports">
				<div className="CodeNode-inputs">
					{indexListEntries(node.inputs).map(([idx]) => (
						<NodeRow key={idx} className="CodeNode-port-row">
							<Port shapeId={shape.id} portId={`input_${idx}`} />
							<span className="CodeNode-port-label">in[{idx}]</span>
						</NodeRow>
					))}
				</div>
				<div className="CodeNode-outputs">
					{indexListEntries(node.outputs).map(([idx]) => (
						<NodeRow key={idx} className="CodeNode-port-row CodeNode-port-row--output">
							<span className="CodeNode-port-label">out[{idx}]</span>
							<Port shapeId={shape.id} portId={`output_${idx}`} />
						</NodeRow>
					))}
				</div>
			</div>

			{/* Code Editor */}
			<div
				className="CodeNode-editor"
				style={{ pointerEvents: 'all' }}
				onKeyDown={(e) => e.stopPropagation()}
			>
				<div className="CodeNode-editor-header">
					<span>python</span>
					<div className="CodeNode-header-actions">
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
					theme="dark"
					extensions={[python()]}
					onChange={handleCodeChange}
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
			>
				<div className="CodeNode-console-header">Console</div>
				{output && <pre className="CodeNode-console-output">{output}</pre>}
			</div>
		</div>
	)
}

function ensureFinalEmptyItem(
	editor: Editor,
	shape: NodeShape,
	items: Record<IndexKey, number>,
	portPrefix: 'input' | 'output',
	{ removeUnused = false } = {}
) {
	const connections = getNodePortConnections(editor, shape.id)

	let entriesToKeep = indexListEntries(items)
	const connectedPortIds = new Set(connections.map((c) => c.ownPortId))

	if (removeUnused) {
		entriesToKeep = entriesToKeep.filter(([idx, value], i) => {
			const portId = `${portPrefix}_${idx}`
			return (
				i === 0 || i === entriesToKeep.length - 1 || value !== 0 || connectedPortIds.has(portId)
			)
		})

		if (entriesToKeep.length < 1) {
			for (const index of getIndicesBetween(
				entriesToKeep[entriesToKeep.length - 1]?.[0],
				null,
				1 - entriesToKeep.length
			)) {
				entriesToKeep.push([index, 0])
			}
		}
	}

	const lastEntry = entriesToKeep[entriesToKeep.length - 1]!
	if (lastEntry[1] !== 0 || connectedPortIds.has(`${portPrefix}_${lastEntry[0]}`)) {
		entriesToKeep.push([getIndexAbove(lastEntry[0]), 0])
	}

	return Object.fromEntries(entriesToKeep)
}
