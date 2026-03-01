import { T, useEditor, useValue } from 'tldraw'
import { GraphIcon } from '../../components/icons/GraphIcon'
import {
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_HEADER_GAP_PX,
	NODE_ROW_HEIGHT_PX,
} from '../../constants'
import { Port, ShapePort } from '../../ports/Port'
import { getNodeInputPortValues } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import {
	asNumber,
	ExecutionResult,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeRow,
	STOP_EXECUTION,
} from './shared'

const DEFAULT_MAX_POINTS = 50
const MIN_POINTS_FOR_SPARKLINE = 2

const GraphPoint = T.object({
	x: T.number,
	y: T.number,
})
type GraphPoint = T.TypeOf<typeof GraphPoint>

export type GraphOutputNode = T.TypeOf<typeof GraphOutputNode>
export const GraphOutputNode = T.object({
	type: T.literal('graphOutput'),
	label: T.string,
	maxPoints: T.number,
	history: T.arrayOf(GraphPoint),
	lastPoint: T.nullable(GraphPoint),
})

export class GraphOutputNodeDefinition extends NodeDefinition<GraphOutputNode> {
	static type = 'graphOutput'
	static validator = GraphOutputNode
	title = 'Graph Output'
	heading = 'Graph'
	icon = (<GraphIcon />)

	getDefault(): GraphOutputNode {
		return {
			type: 'graphOutput',
			label: 'Trend',
			maxPoints: DEFAULT_MAX_POINTS,
			history: [],
			lastPoint: null,
		}
	}

	getBodyHeightPx(_shape: NodeShape, _node: GraphOutputNode) {
		return NODE_ROW_HEIGHT_PX * 5
	}

	getPorts(_shape: NodeShape, _node: GraphOutputNode): Record<string, ShapePort> {
		return {
			x: {
				id: 'x',
				x: 0,
				y: NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX + NODE_ROW_HEIGHT_PX / 2,
				terminal: 'end',
			},
			y: {
				id: 'y',
				x: 0,
				y: NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX + NODE_ROW_HEIGHT_PX * 1.5,
				terminal: 'end',
			},
		}
	}

	async execute(shape: NodeShape, node: GraphOutputNode, inputs: InputValues): Promise<ExecutionResult> {
		let history = node.history
		const maxPoints = Math.max(5, Math.floor(node.maxPoints || DEFAULT_MAX_POINTS))

		const xInput = inputs['x']
		const yInput = inputs['y']

		if (Array.isArray(xInput) && Array.isArray(yInput) && xInput.length === yInput.length) {
			const points = xInput
				.map((xValue, index) => {
					const x = Number(xValue)
					const y = Number(yInput[index])
					if (!Number.isFinite(x) || !Number.isFinite(y)) return null
					return { x, y }
				})
				.filter((point): point is GraphPoint => point !== null)

			if (points.length > 0) {
				history = points.slice(-maxPoints)
			}
		} else {
			const nextPoint = {
				x: asNumber(xInput, node.lastPoint?.x ?? node.history.length),
				y: asNumber(yInput, node.lastPoint?.y ?? 0),
			}
			history = [...node.history, nextPoint].slice(-maxPoints)
		}

		const lastPoint = history.length > 0 ? history[history.length - 1] : null

		this.editor.updateShape({
			id: shape.id,
			type: 'node',
			props: {
				node: {
					...node,
					maxPoints,
					history,
					lastPoint,
				},
				isOutOfDate: false,
			},
		})

		return {}
	}

	getOutputInfo(_shape: NodeShape, _node: GraphOutputNode, _inputs: InfoValues): InfoValues {
		return {}
	}

	Component = GraphOutputNodeComponent
}

export function GraphOutputNodeComponent({ shape, node }: NodeComponentProps<GraphOutputNode>) {
	const editor = useEditor()

	const connectedInputValues = useValue(
		'graph input values',
		() => {
			const portValues = getNodeInputPortValues(editor, shape.id)
			const xValue = portValues['x']
			const yValue = portValues['y']

			const x = !xValue || xValue.value === STOP_EXECUTION ? null : asNumber(xValue.value, NaN)
			const y = !yValue || yValue.value === STOP_EXECUTION ? null : asNumber(yValue.value, NaN)

			return {
				x: Number.isFinite(x) ? x : null,
				y: Number.isFinite(y) ? y : null,
			}
		},
		[editor, shape.id]
	)

	const currentPoint =
		connectedInputValues?.x !== null && connectedInputValues?.y !== null
			? { x: connectedInputValues.x, y: connectedInputValues.y }
			: node.lastPoint
	const data = node.history
	const polyline = getSparklinePolyline(data)

	return (
		<div className="GraphOutputNode">
			<div className="GraphOutputNode-inputs">
				<NodeRow className="GraphOutputNode-input-row">
					<Port shapeId={shape.id} portId="x" />
					<span className="GraphOutputNode-label">x</span>
				</NodeRow>
				<NodeRow className="GraphOutputNode-input-row">
					<Port shapeId={shape.id} portId="y" />
					<span className="GraphOutputNode-label">y</span>
					<span className="GraphOutputNode-current">
						{currentPoint ? `(${formatValue(currentPoint.x)}, ${formatValue(currentPoint.y)})` : '—'}
					</span>
				</NodeRow>
			</div>
			<div className="GraphOutputNode-chart" title="Recent values">
				{polyline ? (
					<svg viewBox="0 0 220 92" preserveAspectRatio="none" className="GraphOutputNode-svg">
						<polyline points={polyline} className="GraphOutputNode-line" />
					</svg>
				) : (
					<div className="GraphOutputNode-empty">No data</div>
				)}
			</div>
		</div>
	)
}

function getSparklinePolyline(points: GraphPoint[]): string | null {
	if (points.length < MIN_POINTS_FOR_SPARKLINE) return null

	const width = 220
	const height = 92
	const xs = points.map((point) => point.x)
	const ys = points.map((point) => point.y)
	const minX = Math.min(...xs)
	const maxX = Math.max(...xs)
	const minY = Math.min(...ys)
	const maxY = Math.max(...ys)
	const rangeX = maxX - minX
	const rangeY = maxY - minY || 1

	return points
		.map((point, index) => {
			const x =
				rangeX === 0
					? (index / Math.max(1, points.length - 1)) * width
					: ((point.x - minX) / rangeX) * width
			const y = height - ((point.y - minY) / rangeY) * height
			return `${x.toFixed(2)},${y.toFixed(2)}`
		})
		.join(' ')
}

function formatValue(value: number): string {
	if (!isFinite(value)) return String(value)
	if (Number.isInteger(value)) return value.toLocaleString()
	return value.toPrecision(6).replace(/\.?0+$/, '')
}
