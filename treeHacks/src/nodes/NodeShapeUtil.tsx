import classNames from 'classnames'
import {
	Circle2d,
	Editor,
	Group2d,
	HTMLContainer,
	RecordProps,
	Rectangle2d,
	resizeBox,
	ShapeUtil,
	T,
	TLResizeInfo,
	TLShape,
	useEditor,
	useUniqueSafeId,
	useValue,
} from 'tldraw'
import { NODE_WIDTH_PX, PORT_RADIUS_PX } from '../constants'
import { executionState } from '../execution/executionState'
import { Port, ShapePort } from '../ports/Port'
import { getNodeOutputPortInfo, getNodePorts } from './nodePorts'
import { getNodeDefinition, getNodeHeightPx, NodeBody, NodeType } from './nodeTypes'
import { NodeValue, STOP_EXECUTION } from './types/shared'

const NODE_TYPE = 'node'

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		// Define our custom node shape type that extends tldraw's base shape system
		[NODE_TYPE]: { node: NodeType; isOutOfDate: boolean; w: number; h: number }
	}
}

export type NodeShape = TLShape<typeof NODE_TYPE>

// This class extends tldraw's ShapeUtil to define how our custom node shapes behave
export class NodeShapeUtil extends ShapeUtil<NodeShape> {
	static override type = NODE_TYPE
	static override props: RecordProps<NodeShape> = {
		node: NodeType,
		isOutOfDate: T.boolean,
		w: T.number,
		h: T.number,
	}

	getDefaultProps(): NodeShape['props'] {
		return {
			node: getNodeDefinition(this.editor, 'add').getDefault(),
			isOutOfDate: false,
			w: NODE_WIDTH_PX,
			h: 0,
		}
	}

	override canEdit() {
		return false
	}
	override canResize() {
		return true
	}
	override hideResizeHandles(_shape: NodeShape) {
		return !this.canResize()
	}
	override hideRotateHandle() {
		return true
	}
	override hideSelectionBoundsBg() {
		return true
	}
	override hideSelectionBoundsFg() {
		return true
	}
	override isAspectRatioLocked() {
		return false
	}
	override getBoundsSnapGeometry(_shape: NodeShape) {
		return {
			points: [{ x: 0, y: 0 }],
		}
	}

	// Define the geometry of our node shape including ports
	getGeometry(shape: NodeShape) {
		const ports = getNodePorts(this.editor, shape)
		const width = getShapeWidth(shape)

		const portGeometries = Object.values(ports).map(
			(port) =>
				new Circle2d({
					x: port.x - PORT_RADIUS_PX,
					y: port.y - PORT_RADIUS_PX,
					radius: PORT_RADIUS_PX,
					isFilled: true,
					// not a label, but this hack excludes them from the selection bounds which is useful
					isLabel: true,
					excludeFromShapeBounds: true,
				})
		)

		const bodyGeometry = new Rectangle2d({
			width,
			height: getNodeHeightPx(this.editor, shape),
			isFilled: true,
		})

		return new Group2d({
			children: [bodyGeometry, ...portGeometries],
		})
	}

	override onResize(shape: any, info: TLResizeInfo<any>) {
		const resized = resizeBox(shape, info) as NodeShape
		const minHeight = shape.props.node?.type === 'code' ? 260 : getNodeMinHeight(this.editor, shape)
		return {
			...resized,
			props: {
				...resized.props,
				w: Math.max(NODE_WIDTH_PX, resized.props.w),
				h: Math.max(minHeight, resized.props.h),
			},
		}
	}

	component(shape: NodeShape) {
		return <NodeShape shape={shape} />
	}

	indicator(shape: NodeShape) {
		const ports = Object.values(getNodePorts(this.editor, shape))
		return <NodeShapeIndicator shape={shape} ports={ports} />
	}
}

// SVG indicator component that shows selection bounds and ports
function NodeShapeIndicator({ shape, ports }: { shape: NodeShape; ports: ShapePort[] }) {
	const id = useUniqueSafeId()
	const editor = useEditor()
	const width = getShapeWidth(shape)

	return (
		<>
			{/* Create a mask to show ports as holes in the selection bounds */}
			<mask id={id}>
				<rect
					width={width + 10}
					height={getNodeHeightPx(editor, shape) + 10}
					fill="white"
					x={-5}
					y={-5}
				/>
				{ports.map((port) => (
					<circle
						key={port.id}
						cx={port.x}
						cy={port.y}
						r={PORT_RADIUS_PX}
						fill="black"
						strokeWidth={0}
					/>
				))}
			</mask>
			<rect
				rx={9}
				width={width}
				height={getNodeHeightPx(editor, shape)}
				mask={`url(#${id})`}
			/>
			{ports.map((port) => (
				<circle key={port.id} cx={port.x} cy={port.y} r={PORT_RADIUS_PX} />
			))}
		</>
	)
}

// Main node component that renders the HTML content
function NodeShape({ shape }: { shape: NodeShape }) {
	const editor = useEditor()

	const handleSelectablePointerCapture = (event: React.PointerEvent) => {
		if (!isSelectableTextTarget(event.target)) return
		editor.markEventAsHandled(event)
		event.stopPropagation()
	}

	const handleSelectableMouseCapture = (event: React.MouseEvent) => {
		if (!isSelectableTextTarget(event.target)) return
		editor.markEventAsHandled(event)
		event.stopPropagation()
	}

	const handleSelectableClickCapture = (event: React.MouseEvent) => {
		if (!isSelectableTextTarget(event.target)) return
		editor.markEventAsHandled(event)
		event.stopPropagation()
	}

	const handleSelectablePointerMoveCapture = (event: React.PointerEvent) => {
		if (!isSelectableTextTarget(event.target)) return
		event.stopPropagation()
	}

	// Get the node's output value
	const output = useValue(
		'output',
		() => getNodeOutputPortInfo(editor, shape.id)?.output ?? undefined,
		[editor, shape.id]
	)

	// Check if this node is currently executing using our execution state
	const isExecuting = useValue(
		'is executing',
		() => executionState.get(editor).runningGraph?.getNodeStatus(shape.id) === 'executing',
		[editor, shape.id]
	)

	const nodeDefinition = getNodeDefinition(editor, shape.props.node)
	const hideHeaderOutputValue = shape.props.node.type === 'gemini'

	return (
		<HTMLContainer
			className={classNames('NodeShape', {
				NodeShape_executing: isExecuting,
			})}
			onPointerDownCapture={handleSelectablePointerCapture}
			onPointerMoveCapture={handleSelectablePointerMoveCapture}
			onMouseDownCapture={handleSelectableMouseCapture}
			onMouseUpCapture={handleSelectableMouseCapture}
			onClickCapture={handleSelectableClickCapture}
			onDoubleClickCapture={handleSelectableClickCapture}
			style={{
				width: `${getShapeWidth(shape)}px`,
				height: `${getNodeHeightPx(editor, shape)}px`,
			}}
		>
			<div className="NodeShape-heading">
				<div className="NodeShape-label">{nodeDefinition.heading ?? nodeDefinition.title}</div>
				{output !== undefined && (
					<>
						{!hideHeaderOutputValue && (
							<div className="NodeShape-output">
								<NodeValue value={output.isOutOfDate ? STOP_EXECUTION : output.value} />
							</div>
						)}
						<Port shapeId={shape.id} portId="output" />
					</>
				)}
			</div>
			<div className="NodeShape-body">
				<NodeBody shape={shape} />
			</div>
		</HTMLContainer>
	)
}

function isSelectableTextTarget(target: EventTarget | null): target is HTMLElement {
	const element =
		target instanceof HTMLElement
			? target
			: target instanceof Node
				? target.parentElement
				: null

	if (!element) return false

	return Boolean(
		element.closest(
			[
				'input',
				'textarea',
				'pre',
				'[contenteditable="true"]',
				'.OutputNode-display',
				'.OutputNode-value',
				'.GeminiNodeSimple-panelBody',
				'.CodeNode-console-output',
				'.cm-content',
				'.cm-line',
				'.NodePortValueDropdown-panel',
			].join(',')
		)
	)
}

function getShapeWidth(shape: NodeShape): number {
	return Math.max(NODE_WIDTH_PX, shape.props.w ?? NODE_WIDTH_PX)
}

function getNodeMinHeight(editor: Editor, shape: NodeShape): number {
	const baseShape = {
		...shape,
		props: {
			...shape.props,
			h: 0,
		},
	} as NodeShape

	return getNodeHeightPx(editor, baseShape)
}
