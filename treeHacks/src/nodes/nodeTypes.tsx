import { Editor, T, useEditor, WeakCache } from 'tldraw'
import {
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_BOTTOM_PADDING_PX,
	NODE_ROW_HEADER_GAP_PX,
} from '../constants'
import { PortId, ShapePort } from '../ports/Port'
import { NodeShape } from './NodeShapeUtil'
import { AddNodeDefinition } from './types/AddNode'
import { ConditionalNodeDefinition } from './types/ConditionalNode'
import { DivideNodeDefinition } from './types/DivideNode'
import { EarthquakeNodeDefinition } from './types/EarthquakeNode'
import { MultiplyNodeDefinition } from './types/MultiplyNode'
import {
	ExecutionResult,
	InfoValues,
	InputValues,
	NodeDefinition,
	NodeDefinitionConstructor,
} from './types/shared'
import { SliderNodeDefinition } from './types/SliderNode'
import { SubtractNodeDefinition } from './types/SubtractNode'
import { CodeNodeDefinition } from './types/CodeNode'
import { OutputNodeDefinition } from './types/OutputNode'
import { PlotNodeDefinition } from './types/PlotNode'
import { GeminiNodeDefinition } from './types/GeminiNode'
import { TextOutputNodeDefinition } from './types/TextOutputNode'
import { NumberOutputNodeDefinition } from './types/NumberOutputNode'
import { FileInputNodeDefinition } from './types/FileInputNode'

/** All our node types */
export const NodeDefinitions = {
	code: CodeNodeDefinition,
	output: OutputNodeDefinition,
	plot: PlotNodeDefinition,
	gemini: GeminiNodeDefinition,
	fileInput: FileInputNodeDefinition,
	textOutput: TextOutputNodeDefinition,
	numberOutput: NumberOutputNodeDefinition,
	add: AddNodeDefinition,
	subtract: SubtractNodeDefinition,
	multiply: MultiplyNodeDefinition,
	divide: DivideNodeDefinition,
	conditional: ConditionalNodeDefinition,
	slider: SliderNodeDefinition,
	earthquake: EarthquakeNodeDefinition,
} satisfies Record<string, NodeDefinitionConstructor<any>>

/**
 * A union type of all our node types.
 */
export type NodeType = T.TypeOf<typeof NodeType>
export const NodeType = T.union(
	'type',
	Object.fromEntries(Object.values(NodeDefinitions).map((type) => [type.type, type.validator])) as {
		[K in keyof typeof NodeDefinitions as (typeof NodeDefinitions)[K]['type']]: (typeof NodeDefinitions)[K]['validator']
	}
)

const nodeDefinitions = new WeakCache<
	Editor,
	{ [K in keyof typeof NodeDefinitions]: InstanceType<(typeof NodeDefinitions)[K]> }
>()
export function getNodeDefinitions(editor: Editor) {
	return nodeDefinitions.get(editor, () => {
		return Object.fromEntries(
			Object.values(NodeDefinitions).map((value) => [value.type, new value(editor)])
		) as any
	})
}

// the other functions in this file are wrappers around the node definitions, dispatching to the
// correct definition for a given node.

export function getNodeDefinition(
	editor: Editor,
	node: NodeType | NodeType['type']
): NodeDefinition<NodeType> {
	return getNodeDefinitions(editor)[
		typeof node === 'string' ? node : node.type
	] as NodeDefinition<NodeType>
}

export function getNodeBodyHeightPx(editor: Editor, shape: NodeShape): number {
	return getNodeDefinition(editor, shape.props.node).getBodyHeightPx(shape, shape.props.node)
}

export function getNodeHeightPx(editor: Editor, shape: NodeShape): number {
	const intrinsicHeight =
		NODE_HEADER_HEIGHT_PX +
		NODE_ROW_HEADER_GAP_PX +
		getNodeBodyHeightPx(editor, shape) +
		NODE_ROW_BOTTOM_PADDING_PX

	return Math.max(intrinsicHeight, shape.props.h ?? 0)
}

export function getNodeTypePorts(editor: Editor, shape: NodeShape): Record<string, ShapePort> {
	return getNodeDefinition(editor, shape.props.node).getPorts(shape, shape.props.node)
}

export async function executeNode(
	editor: Editor,
	shape: NodeShape,
	inputs: InputValues
): Promise<ExecutionResult> {
	return await getNodeDefinition(editor, shape.props.node).execute(shape, shape.props.node, inputs)
}

export function getNodeOutputInfo(
	editor: Editor,
	shape: NodeShape,
	inputs: InfoValues
): InfoValues {
	return getNodeDefinition(editor, shape.props.node).getOutputInfo(shape, shape.props.node, inputs)
}

export function onNodePortConnect(editor: Editor, shape: NodeShape, port: PortId) {
	getNodeDefinition(editor, shape.props.node).onPortConnect?.(shape, shape.props.node, port)
}

export function onNodePortDisconnect(editor: Editor, shape: NodeShape, port: PortId) {
	getNodeDefinition(editor, shape.props.node).onPortDisconnect?.(shape, shape.props.node, port)
}

export function NodeBody({ shape }: { shape: NodeShape }) {
	const editor = useEditor()
	const node = shape.props.node
	const { Component } = getNodeDefinition(editor, node)
	return <Component shape={shape} node={node} />
}
