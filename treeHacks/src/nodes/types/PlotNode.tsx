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
	ExecutionResult,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeRow,
	STOP_EXECUTION,
	updateNode,
} from './shared'

const DEFAULT_MAX_POINTS = 50
const MIN_POINTS_FOR_PLOT = 2

const PlotPoint = T.object({
	x: T.number,
	y: T.number,
})
type PlotPoint = T.TypeOf<typeof PlotPoint>

const PlotBar = T.object({
	label: T.string,
	value: T.number,
})
type PlotBar = T.TypeOf<typeof PlotBar>

const PLOT_MODES = ['line', 'scatter', 'bar'] as const
type PlotMode = (typeof PLOT_MODES)[number]

export type PlotNode = T.TypeOf<typeof PlotNode>
export const PlotNode = T.object({
	type: T.literal('plot'),
	mode: T.string,
	maxPoints: T.number,
	history: T.arrayOf(PlotPoint),
	lastPoint: T.nullable(PlotPoint),
	bars: T.arrayOf(PlotBar),
	lastBar: T.nullable(PlotBar),
})

export class PlotNodeDefinition extends NodeDefinition<PlotNode> {
	static type = 'plot'
	static validator = PlotNode
	title = 'Plot'
	heading = 'Plot'
	icon = (<GraphIcon />)

	getDefault(): PlotNode {
		return {
			type: 'plot',
			mode: 'line',
			maxPoints: DEFAULT_MAX_POINTS,
			history: [],
			lastPoint: null,
			bars: [],
			lastBar: null,
		}
	}

	getBodyHeightPx(_shape: NodeShape, _node: PlotNode) {
		return NODE_ROW_HEIGHT_PX * 8
	}

	getPorts(_shape: NodeShape, _node: PlotNode): Record<string, ShapePort> {
		return {
			input: {
				id: 'input',
				x: 0,
				y: NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX + NODE_ROW_HEIGHT_PX * 1.5,
				terminal: 'end',
			},
		}
	}

	async execute(shape: NodeShape, node: PlotNode, inputs: InputValues): Promise<ExecutionResult> {
		const maxPoints = Math.max(5, Math.floor(node.maxPoints || DEFAULT_MAX_POINTS))
		const mode = parsePlotMode(node.mode)
		const payload = inputs['input']

		if (mode === 'bar') {
			const nextBars = toBarSeries(payload, maxPoints, node.bars)
			const lastBar = nextBars.length > 0 ? nextBars[nextBars.length - 1] : null
			updateNode<PlotNode>(this.editor, shape, (current) => ({
				...current,
				mode,
				maxPoints,
				bars: nextBars,
				lastBar,
			}), false)
			return {}
		}

		const nextHistory = toPointSeries(payload, maxPoints, node.history)
		const lastPoint = nextHistory.length > 0 ? nextHistory[nextHistory.length - 1] : null
		updateNode<PlotNode>(this.editor, shape, (current) => ({
			...current,
			mode,
			maxPoints,
			history: nextHistory,
			lastPoint,
		}), false)
		return {}
	}

	getOutputInfo(_shape: NodeShape, _node: PlotNode, _inputs: InfoValues): InfoValues {
		return {}
	}

	Component = PlotNodeComponent
}

export function PlotNodeComponent({ shape, node }: NodeComponentProps<PlotNode>) {
	const editor = useEditor()

	const inputValue = useValue(
		'plot input value',
		() => {
			const portValues = getNodeInputPortValues(editor, shape.id)
			const input = portValues['input']
			if (!input || input.value === STOP_EXECUTION) return null
			return input.value
		},
		[editor, shape.id]
	)

	const mode = parsePlotMode(node.mode)
	const pointPreview = mode !== 'bar' ? previewPoint(inputValue) ?? node.lastPoint : null
	const barPreview = mode === 'bar' ? previewBar(inputValue) ?? node.lastBar : null

	const polyline = getPolyline(node.history)
	const scatterPoints = getScatterPoints(node.history)
	const bars = node.bars
	const detailItems =
		mode === 'bar'
			? getBarDetailItems(bars, barPreview)
			: getPointDetailItems(node.history, pointPreview)
	const modeLabel = mode === 'bar' ? 'bar' : mode === 'scatter' ? 'scatter' : 'line'

	return (
		<div className="PlotNode">
			<NodeRow className="PlotNode-mode-row">
				<span className="PlotNode-label">mode</span>
				<select
					value={mode}
					onChange={(event) => {
						const nextMode = parsePlotMode(event.target.value)
						updateNode<PlotNode>(editor, shape, (current) => ({
							...current,
							mode: nextMode,
						}), false)
					}}
					onPointerDown={editor.markEventAsHandled}
					onFocus={() => editor.setSelectedShapes([shape.id])}
				>
					<option value="line">Line</option>
					<option value="scatter">Scatter</option>
					<option value="bar">Bar</option>
				</select>
				<span className="PlotNode-modeBadge">{modeLabel}</span>
			</NodeRow>

			<NodeRow className="PlotNode-input-row">
				<Port shapeId={shape.id} portId="input" />
				<span className="PlotNode-label">
					{mode === 'bar' ? 'input (bar payload)' : 'input (x/y payload)'}
				</span>
				<span className="PlotNode-current">
					{mode === 'bar'
						? barPreview
							? `${barPreview.label}: ${formatValue(barPreview.value)}`
							: '—'
						: pointPreview
							? `(${formatValue(pointPreview.x)}, ${formatValue(pointPreview.y)})`
							: '—'}
				</span>
			</NodeRow>

			<div className="PlotNode-card">
				<div className="PlotNode-chartWrap">
					<div className="PlotNode-chartHeader">
						<span>Preview</span>
						<span className="PlotNode-chartMeta">{detailItems[0]?.value ?? 'No data'}</span>
					</div>
					<div className="PlotNode-chart" title="Recent values">
						{mode === 'bar' ? (
							bars.length > 0 ? (
								<svg width="220" height="92" viewBox="0 0 220 92" preserveAspectRatio="xMidYMid meet" className="PlotNode-svg">
									{renderBarAxes()}
									{renderBars(bars)}
								</svg>
							) : (
								<div className="PlotNode-empty">No data</div>
							)
						) : mode === 'scatter' ? (
							scatterPoints.length > 0 ? (
								<svg width="220" height="92" viewBox="0 0 220 92" preserveAspectRatio="xMidYMid meet" className="PlotNode-svg">
									{renderPointAxes()}
									{scatterPoints.map((point, index) => (
										<circle key={index} cx={point.x} cy={point.y} r={2.6} className="PlotNode-dot" />
									))}
								</svg>
							) : (
								<div className="PlotNode-empty">No data</div>
							)
						) : polyline ? (
							<svg width="220" height="92" viewBox="0 0 220 92" preserveAspectRatio="xMidYMid meet" className="PlotNode-svg">
								{renderPointAxes()}
								<polyline points={polyline} className="PlotNode-line" />
							</svg>
						) : (
							<div className="PlotNode-empty">No data</div>
						)}
					</div>
				</div>

				<div className="PlotNode-details">
					{detailItems.slice(1).map((item) => (
						<div key={item.label} className="PlotNode-detailItem">
							<span className="PlotNode-detailLabel">{item.label}</span>
							<span className="PlotNode-detailValue">{item.value}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}

function getPointDetailItems(points: PlotPoint[], preview: PlotPoint | null): Array<{ label: string; value: string }> {
	if (points.length === 0) {
		return [
			{ label: 'Samples', value: '0' },
			{ label: 'Latest', value: preview ? `(${formatValue(preview.x)}, ${formatValue(preview.y)})` : '—' },
			{ label: 'X range', value: '—' },
			{ label: 'Y range', value: '—' },
			{ label: 'Y avg', value: '—' },
		]
	}

	const xs = points.map((point) => point.x)
	const ys = points.map((point) => point.y)
	const xMin = Math.min(...xs)
	const xMax = Math.max(...xs)
	const yMin = Math.min(...ys)
	const yMax = Math.max(...ys)
	const yAvg = ys.reduce((total, value) => total + value, 0) / ys.length
	const last = preview ?? points[points.length - 1]

	return [
		{ label: 'Samples', value: `${points.length}` },
		{ label: 'Latest', value: `(${formatValue(last.x)}, ${formatValue(last.y)})` },
		{ label: 'X range', value: `${formatValue(xMin)} → ${formatValue(xMax)}` },
		{ label: 'Y range', value: `${formatValue(yMin)} → ${formatValue(yMax)}` },
		{ label: 'Y avg', value: formatValue(yAvg) },
	]
}

function getBarDetailItems(bars: PlotBar[], preview: PlotBar | null): Array<{ label: string; value: string }> {
	if (bars.length === 0) {
		return [
			{ label: 'Bars', value: '0' },
			{ label: 'Latest', value: preview ? `${preview.label}: ${formatValue(preview.value)}` : '—' },
			{ label: 'Value range', value: '—' },
			{ label: 'Total', value: '—' },
			{ label: 'Top bar', value: '—' },
		]
	}

	const values = bars.map((bar) => bar.value)
	const min = Math.min(...values)
	const max = Math.max(...values)
	const total = values.reduce((sum, value) => sum + value, 0)
	const top = bars.reduce((best, bar) => (Math.abs(bar.value) > Math.abs(best.value) ? bar : best), bars[0])
	const last = preview ?? bars[bars.length - 1]

	return [
		{ label: 'Bars', value: `${bars.length}` },
		{ label: 'Latest', value: `${last.label}: ${formatValue(last.value)}` },
		{ label: 'Value range', value: `${formatValue(min)} → ${formatValue(max)}` },
		{ label: 'Total', value: formatValue(total) },
		{ label: 'Top bar', value: `${top.label}: ${formatValue(top.value)}` },
	]
}

function toPointSeries(rawInput: unknown, maxPoints: number, existing: PlotPoint[]): PlotPoint[] {
	const points = extractPoints(rawInput)
	if (points.length > 0) {
		if (Array.isArray(rawInput) || isPlainObject(rawInput)) {
			return points.slice(-maxPoints)
		}
		return [...existing, ...points].slice(-maxPoints)
	}

	if (typeof rawInput === 'number' && Number.isFinite(rawInput)) {
		const lastPoint = existing.length > 0 ? existing[existing.length - 1] : null
		const nextPoint = {
			x: lastPoint?.x ?? existing.length,
			y: rawInput,
		}
		return [...existing, nextPoint].slice(-maxPoints)
	}

	return existing
}

function toBarSeries(rawInput: unknown, maxPoints: number, existing: PlotBar[]): PlotBar[] {
	const bars = extractBars(rawInput)
	if (bars.length > 0) {
		if (Array.isArray(rawInput) || isPlainObject(rawInput)) {
			return bars.slice(-maxPoints)
		}
		return [...existing, ...bars].slice(-maxPoints)
	}

	if (typeof rawInput === 'number' && Number.isFinite(rawInput)) {
		return [...existing, { label: `item ${existing.length + 1}`, value: rawInput }].slice(-maxPoints)
	}

	return existing
}

function extractPoints(rawInput: unknown): PlotPoint[] {
	if (rawInput === null || rawInput === undefined) return []

	if (Array.isArray(rawInput)) {
		return rawInput
			.map((value, index) => {
				if (Array.isArray(value) && value.length >= 2) {
					const x = Number(value[0])
					const y = Number(value[1])
					if (!Number.isFinite(x) || !Number.isFinite(y)) return null
					return { x, y }
				}

				if (isPlainObject(value) && 'x' in value && 'y' in value) {
					const x = Number(value.x)
					const y = Number(value.y)
					if (!Number.isFinite(x) || !Number.isFinite(y)) return null
					return { x, y }
				}

				if (typeof value === 'number' && Number.isFinite(value)) {
					return { x: index, y: value }
				}

				return null
			})
			.filter((point): point is PlotPoint => point !== null)
	}

	if (isPlainObject(rawInput) && 'x' in rawInput && 'y' in rawInput) {
		const xField = rawInput.x
		const yField = rawInput.y

		if (Array.isArray(xField) && Array.isArray(yField) && xField.length === yField.length) {
			return xField
				.map((xValue, index) => {
					const x = Number(xValue)
					const y = Number(yField[index])
					if (!Number.isFinite(x) || !Number.isFinite(y)) return null
					return { x, y }
				})
				.filter((point): point is PlotPoint => point !== null)
		}

		const x = Number(xField)
		const y = Number(yField)
		if (Number.isFinite(x) && Number.isFinite(y)) {
			return [{ x, y }]
		}
	}

	return []
}

function extractBars(rawInput: unknown): PlotBar[] {
	if (rawInput === null || rawInput === undefined) return []

	if (Array.isArray(rawInput)) {
		return rawInput
			.map((value, index) => {
				if (Array.isArray(value) && value.length >= 2) {
					const label = normalizeLabel(value[0]) || `item ${index + 1}`
					const numberValue = Number(value[1])
					if (!Number.isFinite(numberValue)) return null
					return { label, value: numberValue }
				}

				if (isPlainObject(value) && 'label' in value && 'value' in value) {
					const label = normalizeLabel(value.label) || `item ${index + 1}`
					const numberValue = Number(value.value)
					if (!Number.isFinite(numberValue)) return null
					return { label, value: numberValue }
				}

				return null
			})
			.filter((bar): bar is PlotBar => bar !== null)
	}

	if (isPlainObject(rawInput)) {
		if ('labels' in rawInput && 'values' in rawInput) {
			const labels = rawInput.labels
			const values = rawInput.values
			if (Array.isArray(labels) && Array.isArray(values) && labels.length === values.length) {
				return labels
					.map((labelValue, index) => {
						const label = normalizeLabel(labelValue) || `item ${index + 1}`
						const numberValue = Number(values[index])
						if (!Number.isFinite(numberValue)) return null
						return { label, value: numberValue }
					})
					.filter((bar): bar is PlotBar => bar !== null)
			}
		}

		if ('label' in rawInput && 'value' in rawInput) {
			const label = normalizeLabel(rawInput.label) || 'item 1'
			const numberValue = Number(rawInput.value)
			if (Number.isFinite(numberValue)) {
				return [{ label, value: numberValue }]
			}
		}
	}

	return []
}

function previewPoint(inputValue: unknown): PlotPoint | null {
	const points = extractPoints(inputValue)
	return points.length > 0 ? points[points.length - 1] : null
}

function previewBar(inputValue: unknown): PlotBar | null {
	const bars = extractBars(inputValue)
	return bars.length > 0 ? bars[bars.length - 1] : null
}

function normalizeLabel(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

function getPolyline(points: PlotPoint[]): string | null {
	if (points.length < MIN_POINTS_FOR_PLOT) return null
	const scaled = getScaledPoints(points)
	return scaled.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')
}

function getScatterPoints(points: PlotPoint[]): Array<{ x: number; y: number }> {
	if (points.length === 0) return []
	return getScaledPoints(points)
}

function getScaledPoints(points: PlotPoint[]): Array<{ x: number; y: number }> {
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

	return points.map((point, index) => {
		const x =
			rangeX === 0
				? (index / Math.max(1, points.length - 1)) * width
				: ((point.x - minX) / rangeX) * width
		const y = height - ((point.y - minY) / rangeY) * height
		return { x, y }
	})
}

function renderBars(bars: PlotBar[]) {
	const width = 220
	const height = 92
	const gap = 4
	const barCount = bars.length
	const barWidth = Math.max(6, (width - gap * Math.max(0, barCount - 1)) / Math.max(1, barCount))
	const maxValue = Math.max(1, ...bars.map((bar) => Math.abs(bar.value)))

	return bars.map((bar, index) => {
		const normalized = Math.abs(bar.value) / maxValue
		const barHeight = Math.max(2, normalized * height)
		const x = index * (barWidth + gap)
		const y = height - barHeight
		return (
			<rect
				key={`${bar.label}-${index}`}
				x={x}
				y={y}
				width={barWidth}
				height={barHeight}
				className="PlotNode-bar"
				rx={1.5}
			/>
		)
	})
}

function renderPointAxes() {
	return (
		<g className="PlotNode-axes">
			<line x1={0} y1={0} x2={220} y2={0} className="PlotNode-axisLine" />
			<line x1={0} y1={46} x2={220} y2={46} className="PlotNode-axisLine PlotNode-axisLine--mid" />
			<line x1={0} y1={92} x2={220} y2={92} className="PlotNode-axisLine" />
			<line x1={0} y1={90} x2={0} y2={92} className="PlotNode-axisTick" />
			<line x1={220} y1={90} x2={220} y2={92} className="PlotNode-axisTick" />
			<line x1={0} y1={0} x2={2} y2={0} className="PlotNode-axisTick" />
			<line x1={0} y1={92} x2={2} y2={92} className="PlotNode-axisTick" />
		</g>
	)
}

function renderBarAxes() {
	return (
		<g className="PlotNode-axes">
			<line x1={0} y1={0} x2={220} y2={0} className="PlotNode-axisLine" />
			<line x1={0} y1={46} x2={220} y2={46} className="PlotNode-axisLine PlotNode-axisLine--mid" />
			<line x1={0} y1={92} x2={220} y2={92} className="PlotNode-axisLine" />
			<line x1={0} y1={0} x2={2} y2={0} className="PlotNode-axisTick" />
			<line x1={0} y1={92} x2={2} y2={92} className="PlotNode-axisTick" />
		</g>
	)
}

function formatValue(value: number): string {
	if (!isFinite(value)) return String(value)
	if (Number.isInteger(value)) return value.toLocaleString()
	return value.toPrecision(6).replace(/\.?0+$/, '')
}

function parsePlotMode(value: string): PlotMode {
	return PLOT_MODES.includes(value as PlotMode) ? (value as PlotMode) : 'line'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
