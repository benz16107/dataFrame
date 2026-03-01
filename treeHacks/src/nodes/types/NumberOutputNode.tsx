import { T, useEditor } from 'tldraw'
import { NumberOutputIcon } from '../../components/icons/NumberOutputIcon'
import {
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_HEIGHT_PX,
	NODE_WIDTH_PX,
} from '../../constants'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import {
	ExecutionResult,
	InfoValues,
	NodeComponentProps,
	NodeDefinition,
	NodeRow,
	updateNode,
} from './shared'

export type NumberOutputNode = T.TypeOf<typeof NumberOutputNode>
export const NumberOutputNode = T.object({
	type: T.literal('numberOutput'),
	value: T.number,
})

export class NumberOutputNodeDefinition extends NodeDefinition<NumberOutputNode> {
	static type = 'numberOutput'
	static validator = NumberOutputNode
	title = 'Number'
	heading = 'Number'
	icon = (<NumberOutputIcon />)

	getDefault(): NumberOutputNode {
		return {
			type: 'numberOutput',
			value: 0,
		}
	}

	getBodyHeightPx(_shape: NodeShape, _node: NumberOutputNode) {
		return NODE_ROW_HEIGHT_PX * 1.5
	}

	getPorts(shape: NodeShape, _node: NumberOutputNode): Record<string, ShapePort> {
		const width = Math.max(NODE_WIDTH_PX, shape.props.w || NODE_WIDTH_PX)
		return {
			output: {
				id: 'output',
				x: width,
				y: NODE_HEADER_HEIGHT_PX / 2,
				terminal: 'start',
			},
		}
	}

	async execute(_shape: NodeShape, node: NumberOutputNode): Promise<ExecutionResult> {
		return { output: node.value }
	}

	getOutputInfo(shape: NodeShape, node: NumberOutputNode): InfoValues {
		return {
			output: {
				value: node.value,
				isOutOfDate: shape.props.isOutOfDate,
			},
		}
	}

	Component = NumberOutputNodeComponent
}

export function NumberOutputNodeComponent({ shape, node }: NodeComponentProps<NumberOutputNode>) {
	const editor = useEditor()

	return (
		<NodeRow className="NumberOutputNode">
			<input
				type="number"
				step="any"
				value={node.value}
				onChange={(event) => {
					const next = Number(event.target.value)
					if (!Number.isFinite(next)) return
					updateNode<NumberOutputNode>(editor, shape, (current) => ({
						...current,
						value: next,
					}))
				}}
				onPointerDown={editor.markEventAsHandled}
				onFocus={() => editor.setSelectedShapes([shape.id])}
			/>
		</NodeRow>
	)
}
