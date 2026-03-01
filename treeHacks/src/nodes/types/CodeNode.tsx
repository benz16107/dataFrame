import { Editor, getIndexAbove, getIndicesBetween, IndexKey, T, useEditor } from 'tldraw'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { useState, useCallback, PointerEvent } from 'react'
import { Pyodide } from '@/pyodide'
import { CodeIcon } from '../../components/icons/CodeIcon'
import {
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_HEADER_GAP_PX,
	NODE_ROW_HEIGHT_PX,
	NODE_WIDTH_PX,
} from '../../constants'
import { Port, ShapePort } from '../../ports/Port'
import { indexList, indexListEntries, indexListLength } from '../../utils'
import { getNodePortConnections } from '../nodePorts'
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
	inputs: T.dict(T.indexKey, T.number),
	outputs: T.dict(T.indexKey, T.number),
	lastResult: T.number.nullable(),
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
			code: "# Python code\nprint('Hello!')\n",
			inputs: indexList([0]),
			outputs: indexList([0]),
			lastResult: null,
		}
	}

	// The height of the node is based on the number of input/output rows plus the code editor
	getBodyHeightPx(_shape: NodeShape, node: CodeNode) {
		const inputRows = indexListLength(node.inputs)
		const outputRows = indexListLength(node.outputs)
		const maxRows = Math.max(inputRows, outputRows)
		return NODE_ROW_HEIGHT_PX * maxRows + CODE_EDITOR_MIN_HEIGHT_PX + CONSOLE_OUTPUT_HEIGHT_PX
	}

	getPorts(_shape: NodeShape, node: CodeNode): Record<string, ShapePort> {
		const ports: Record<string, ShapePort> = {}

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
					x: NODE_WIDTH_PX,
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

	// For now, execute does nothing with inputs/outputs - just runs the code
	async execute(_shape: NodeShape, node: CodeNode, _inputs: InputValues): Promise<ExecutionResult> {
		// Return dummy output values for now
		const result: ExecutionResult = {}
		Object.keys(node.outputs).forEach((idx) => {
			result[`output_${idx}`] = node.outputs[idx as IndexKey] ?? 0
		})
		return result
	}

	getOutputInfo(shape: NodeShape, node: CodeNode, inputs: InfoValues): InfoValues {
		const result: InfoValues = {}
		Object.keys(node.outputs).forEach((idx) => {
			result[`output_${idx}`] = {
				value: node.outputs[idx as IndexKey] ?? 0,
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

			await pyodide.run(node.code)
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
				onPointerDown={onPointerDown}
				onKeyDown={(e) => e.stopPropagation()}
			>
				<div className="CodeNode-editor-header">
					<span>python</span>
					<button
						onClick={executePython}
						disabled={isRunning}
						className="CodeNode-run-button"
					>
						{isRunning ? 'Running...' : 'Run'}
					</button>
				</div>
				<CodeMirror
					value={node.code}
					height="100px"
					theme="dark"
					extensions={[python()]}
					onChange={handleCodeChange}
					style={{ fontSize: '12px' }}
				/>
			</div>

			{/* Console Output */}
			<div className="CodeNode-console" onPointerDown={onPointerDown}>
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
