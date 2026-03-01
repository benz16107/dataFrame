import { useCallback } from 'react'
import { T, useEditor, useValue } from 'tldraw'
import {
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_HEADER_GAP_PX,
	NODE_ROW_HEIGHT_PX,
} from '../../constants'
import { Port, ShapePort } from '../../ports/Port'
import { getNodeInputPortValues } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import {
	CopyTextButton,
	ExecutionResult,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeRow,
	STOP_EXECUTION,
	WorkflowValue,
} from './shared'

// Simple display icon
function OutputIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" />
			<line x1="5" y1="7" x2="11" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			<line x1="5" y1="10" x2="9" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	)
}

export type OutputNode = T.TypeOf<typeof OutputNode>
export const OutputNode = T.object({
	type: T.literal('output'),
	label: T.string,
	lastValue: T.any.nullable(),
})

export class OutputNodeDefinition extends NodeDefinition<OutputNode> {
	static type = 'output'
	static validator = OutputNode
	title = 'Output'
	heading = 'Output'
	icon = (<OutputIcon />)

	getDefault(): OutputNode {
		return {
			type: 'output',
			label: 'Result',
			lastValue: null,
		}
	}

	getBodyHeightPx(_shape: NodeShape, _node: OutputNode) {
		return NODE_ROW_HEIGHT_PX * 2
	}

	getPorts(_shape: NodeShape, _node: OutputNode): Record<string, ShapePort> {
		return {
			input: {
				id: 'input',
				x: 0,
				y: NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX + NODE_ROW_HEIGHT_PX / 2,
				terminal: 'end',
			},
		}
	}

	async execute(shape: NodeShape, node: OutputNode, inputs: InputValues): Promise<ExecutionResult> {
		const inputValue = inputs['input'] ?? null

		// Update the node with the received value
		this.editor.updateShape({
			id: shape.id,
			type: 'node',
			props: {
				node: {
					...node,
					lastValue: inputValue,
				},
				isOutOfDate: false,
			},
		})

		// Output nodes don't produce outputs
		return {}
	}

	getOutputInfo(_shape: NodeShape, _node: OutputNode, _inputs: InfoValues): InfoValues {
		// No outputs
		return {}
	}

	Component = OutputNodeComponent
}

export function OutputNodeComponent({ shape, node }: NodeComponentProps<OutputNode>) {
	const editor = useEditor()
	const handleSelectablePointerDown = useCallback((event: React.PointerEvent) => {
		editor.markEventAsHandled(event)
		event.stopPropagation()
	}, [editor])
	const handleSelectableMouseDown = useCallback((event: React.MouseEvent) => {
		editor.markEventAsHandled(event)
		event.stopPropagation()
	}, [editor])
	const handleSelectableWheel = useCallback((event: React.WheelEvent) => {
		event.stopPropagation()
	}, [])

	// Get the current input value from connected nodes
	const inputValue = useValue(
		'input value',
		() => {
			const portValues = getNodeInputPortValues(editor, shape.id)
			const input = portValues['input']
			if (!input) return null
			if (input.value === STOP_EXECUTION) return null
			return input.value
		},
		[editor, shape.id]
	)

	// Use connected value if available, otherwise use lastValue
	const displayValue = inputValue ?? node.lastValue

	return (
		<div className="OutputNode">
			<NodeRow className="OutputNode-input-row">
				<Port shapeId={shape.id} portId="input" />
				<span className="OutputNode-label">{node.label}</span>
			</NodeRow>
			<div
				className="OutputNode-display"
				onPointerDownCapture={handleSelectablePointerDown}
				onMouseDownCapture={handleSelectableMouseDown}
				onWheelCapture={handleSelectableWheel}
			>
				<CopyTextButton
					title="Copy output"
					getText={() => (displayValue === null ? '' : formatValue(displayValue))}
					disabled={displayValue === null}
				/>
				{displayValue !== null ? (
					<span className={`OutputNode-value ${typeof displayValue === 'number' ? 'OutputNode-value--number' : 'OutputNode-value--text'}`}>
						{formatValue(displayValue)}
					</span>
				) : (
					<span className="OutputNode-placeholder">No value</span>
				)}
			</div>
		</div>
	)
}

function formatValue(value: WorkflowValue): string {
	if (typeof value === 'number') {
		if (!isFinite(value)) return String(value)

		if (Number.isInteger(value)) {
			return value.toLocaleString()
		}

		return value.toPrecision(6).replace(/\.?0+$/, '')
	}

	if (typeof value === 'string') return value
	if (typeof value === 'boolean') return value ? 'true' : 'false'
	if (value === null || value === undefined) return ''

	try {
		return JSON.stringify(value, null, 2)
	} catch {
		return String(value)
	}
}
