import { T, useEditor } from 'tldraw'
import { TextOutputIcon } from '../../components/icons/TextOutputIcon'
import {
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_HEIGHT_PX,
	NODE_WIDTH_PX,
} from '../../constants'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import {
	CopyTextButton,
	ExecutionResult,
	InfoValues,
	NodeComponentProps,
	NodeDefinition,
	NodeRow,
	updateNode,
} from './shared'

export type TextOutputNode = T.TypeOf<typeof TextOutputNode>
export const TextOutputNode = T.object({
	type: T.literal('textOutput'),
	text: T.string,
})

export class TextOutputNodeDefinition extends NodeDefinition<TextOutputNode> {
	static type = 'textOutput'
	static validator = TextOutputNode
	title = 'Text'
	heading = 'Text'
	icon = (<TextOutputIcon />)

	getDefault(): TextOutputNode {
		return {
			type: 'textOutput',
			text: '',
		}
	}

	getBodyHeightPx(_shape: NodeShape, _node: TextOutputNode) {
		return NODE_ROW_HEIGHT_PX * 2
	}

	getPorts(shape: NodeShape, _node: TextOutputNode): Record<string, ShapePort> {
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

	async execute(_shape: NodeShape, node: TextOutputNode): Promise<ExecutionResult> {
		return { output: node.text }
	}

	getOutputInfo(shape: NodeShape, node: TextOutputNode): InfoValues {
		return {
			output: {
				value: node.text,
				isOutOfDate: shape.props.isOutOfDate,
			},
		}
	}

	Component = TextOutputNodeComponent
}

export function TextOutputNodeComponent({ shape, node }: NodeComponentProps<TextOutputNode>) {
	const editor = useEditor()

	return (
		<NodeRow className="TextOutputNode">
			<CopyTextButton title="Copy text" getText={() => node.text} />
			<textarea
				value={node.text}
				placeholder="Type text to output"
				onChange={(event) =>
					updateNode<TextOutputNode>(editor, shape, (current) => ({
						...current,
						text: event.target.value,
					}))
				}
				onPointerDown={editor.markEventAsHandled}
				onFocus={() => editor.setSelectedShapes([shape.id])}
			/>
		</NodeRow>
	)
}
