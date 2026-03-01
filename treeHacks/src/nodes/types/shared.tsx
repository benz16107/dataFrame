import classNames from 'classnames'
import { KeyboardEvent, MouseEvent, PointerEvent, useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
	Editor,
	T,
	TldrawUiButton,
	TldrawUiButtonIcon,
	TLShapeId,
	TLUiIconJsx,
	useEditor,
	useValue,
} from 'tldraw'
import { AddIcon } from '../../components/icons/AddIcon'
import { SubtractIcon } from '../../components/icons/SubtractIcon'
import { NODE_HEADER_HEIGHT_PX, NODE_WIDTH_PX } from '../../constants'
import { Port, PortId, ShapePort } from '../../ports/Port'
import { getNodeInputPortValues } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import { NodeType } from '../nodeTypes'

// WorkflowValue can be any JSON-serializable value (numbers, strings, arrays, objects, DataFrames)
export type WorkflowValue = unknown

/**
 * A special value that can be returned from a node to indicate that execution should stop.
 */
export type STOP_EXECUTION = typeof STOP_EXECUTION
export const STOP_EXECUTION = Symbol('STOP_EXECUTION')

export interface InfoValues {
	[key: string]: { value: WorkflowValue | STOP_EXECUTION; isOutOfDate: boolean }
}

export interface ExecutionResult {
	[key: string]: WorkflowValue | STOP_EXECUTION
}

export interface InputValues {
	[key: string]: WorkflowValue
}

export function asNumber(
	value: WorkflowValue | STOP_EXECUTION | null | undefined,
	fallback = 0
): number {
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value === 'string') {
		const parsed = Number(value.trim())
		if (Number.isFinite(parsed)) return parsed
	}
	return fallback
}

export interface NodeComponentProps<Node extends { type: string }> {
	shape: NodeShape
	node: Node
}

export abstract class NodeDefinition<Node extends { type: string }> {
	constructor(public readonly editor: Editor) {
		const ctor = this.constructor as NodeDefinitionConstructor<Node>
		this.type = ctor.type
		this.validator = ctor.validator
	}

	readonly type: Node['type']
	readonly validator: T.Validator<Node>
	abstract readonly title: string
	abstract readonly heading?: string
	abstract readonly icon: TLUiIconJsx

	abstract getDefault(): Node
	abstract getBodyHeightPx(shape: NodeShape, node: Node): number
	abstract getPorts(shape: NodeShape, node: Node): Record<string, ShapePort>
	onPortConnect(_shape: NodeShape, _node: Node, _port: PortId): void {}
	onPortDisconnect(_shape: NodeShape, _node: Node, _port: PortId): void {}
	abstract getOutputInfo(shape: NodeShape, node: Node, inputs: InfoValues): InfoValues
	abstract execute(shape: NodeShape, node: Node, inputs: InputValues): Promise<ExecutionResult>
	abstract Component: React.ComponentType<NodeComponentProps<Node>>
}

export interface NodeDefinitionConstructor<Node extends { type: string }> {
	new (editor: Editor): NodeDefinition<Node>
	readonly type: Node['type']
	readonly validator: T.Validator<Node>
}

/**
 * The standard output port for a node, appearing in the node header.
 */
export const outputPort: ShapePort = {
	id: 'output',
	x: NODE_WIDTH_PX,
	y: NODE_HEADER_HEIGHT_PX / 2,
	terminal: 'start',
}

/**
 * Update the `node` prop within a node shape.
 */
export function updateNode<T extends NodeType>(
	editor: Editor,
	shape: NodeShape,
	update: (node: T) => T,
	isOutOfDate: boolean = true
) {
	editor.updateShape({
		id: shape.id,
		type: shape.type,
		props: { node: update(shape.props.node as T), isOutOfDate },
	})
}

/**
 * A row in a node. This component just applies some styling.
 */
export function NodeRow({
	children,
	className,
	...props
}: {
	children: React.ReactNode
	className?: string
} & React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div {...props} className={classNames('NodeRow', className)}>
			{children}
		</div>
	)
}

/**
 * A row in a node for a numeric input. If the port is connected, the input is disabled and the
 * value is taken from the port. Otherwise, the input is editable with a spinner for incrementing
 * and decrementing the value.
 */
export function NodeInputRow({
	shapeId,
	portId,
	value,
	onChange,
	onBlur,
}: {
	shapeId: TLShapeId
	portId: PortId
	value: number
	onChange: (value: number) => void
	onBlur?: () => void
}) {
	const editor = useEditor()
	const inputRef = useRef<HTMLInputElement>(null)
	const portInfo = useValue('from port', () => getNodeInputPortValues(editor, shapeId)[portId], [
		editor,
		shapeId,
		portId,
	])
	const valueFromPort = portInfo?.value
	const isOutOfDate = portInfo?.isOutOfDate

	const [pendingValue, setPendingValue] = useState<string | null>(null)

	const onPointerDown = useCallback((event: PointerEvent) => {
		event.stopPropagation()
	}, [])

	const onSpinner = (delta: number) => {
		const newValue = value + delta
		onChange(newValue)
		setPendingValue(String(newValue))
		inputRef.current?.focus()
	}

	// Get display value - convert to number if possible
	const displayValue = typeof valueFromPort === 'number' ? valueFromPort :
		(valueFromPort != null ? 0 : (pendingValue ?? value))

	return (
		<NodeRow className="NodeInputRow">
			<Port shapeId={shapeId} portId={portId} />
			{isOutOfDate || valueFromPort === STOP_EXECUTION ? (
				<NodeValue value={isOutOfDate ? STOP_EXECUTION : valueFromPort} />
			) : (
				<input
					ref={inputRef}
					type="text"
					inputMode="decimal"
					disabled={valueFromPort != null}
					value={displayValue}
					onChange={(e) => {
						setPendingValue(e.currentTarget.value)
						const asNumber = Number(e.currentTarget.value.trim())
						if (Number.isNaN(asNumber)) return
						onChange(asNumber)
					}}
					onPointerDown={onPointerDown}
					onBlur={() => {
						setPendingValue(null)
						onBlur?.()
					}}
					onFocus={() => {
						editor.setSelectedShapes([shapeId])
					}}
				/>
			)}
			<div className="NodeInputRow-buttons">
				<TldrawUiButton
					title="decrement"
					type="icon"
					onPointerDown={onPointerDown}
					onClick={() => onSpinner(-1)}
				>
					<TldrawUiButtonIcon icon={<SubtractIcon />} />
				</TldrawUiButton>
				<TldrawUiButton
					title="increment"
					type="icon"
					onPointerDown={onPointerDown}
					onClick={() => onSpinner(1)}
				>
					<TldrawUiButtonIcon icon={<AddIcon />} />
				</TldrawUiButton>
			</div>
		</NodeRow>
	)
}

/**
 * Format a number to display with up to 5 significant figures, using suffixes for large numbers.
 */
function formatNumber(value: number): string {
	// Handle special cases
	if (value === 0) return '0'
	if (!isFinite(value)) return value.toString()

	const absValue = Math.abs(value)
	const sign = value < 0 ? '-' : ''

	// For very large numbers, use suffixes
	if (absValue >= 1_000_000_000) {
		return sign + (absValue / 1_000_000_000).toPrecision(3) + 'B'
	}
	if (absValue >= 1_000_000) {
		return sign + (absValue / 1_000_000).toPrecision(3) + 'M'
	}
	if (absValue >= 1_000) {
		return sign + (absValue / 1_000).toPrecision(3) + 'k'
	}

	// For smaller numbers, use up to 5 significant figures
	if (absValue >= 1) {
		// For numbers >= 1, limit to 5 significant figures
		return sign + absValue.toPrecision(5).replace(/\.?0+$/, '')
	} else if (absValue >= 0.001) {
		// For numbers between 0.001 and 1, show up to 5 significant figures
		return sign + absValue.toPrecision(3)
	} else {
		// For very small numbers, use scientific notation
		return value.toExponential(2)
	}
}

/**
 * A value within a node. If the value is STOP_EXECUTION, a placeholder is shown instead.
 */
export function NodeValue({ value }: { value: WorkflowValue | STOP_EXECUTION }) {
	if (value === STOP_EXECUTION) {
		return <div className="NodeValue_placeholder" />
	}

	if (typeof value === 'number') {
		return <>{formatNumber(value)}</>
	}

	if (value === null || value === undefined) {
		return <div className="NodeValue_placeholder" />
	}

	// For non-numbers, show a simplified representation
	if (typeof value === 'object') {
		const obj = value as Record<string, unknown>
		if (obj.__type__ === 'dataframe') {
			return <>DataFrame</>
		}
		return <>Object</>
	}

	return <>{String(value)}</>
}

function formatPortPreviewValue(value: WorkflowValue | STOP_EXECUTION): string {
	if (value === STOP_EXECUTION) {
		return '(out of date)'
	}

	if (value === undefined) {
		return '(undefined)'
	}

	if (value === null) {
		return 'null'
	}

	if (typeof value === 'string') {
		return value.length > 0 ? value : '(empty string)'
	}

	if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
		return String(value)
	}

	try {
		return JSON.stringify(value, null, 2)
	} catch {
		return String(value)
	}
}

export function PortValueDropdown({
	title,
	value,
	align = 'left',
}: {
	title?: string
	value: WorkflowValue | STOP_EXECUTION
	align?: 'left' | 'right'
}) {
	const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
		event.stopPropagation()
	}, [])

	return (
		<details
			className={classNames('NodePortValueDropdown', align === 'right' && 'NodePortValueDropdown--right')}
			onPointerDown={onPointerDown}
			onClick={(event) => event.stopPropagation()}
		>
			<summary className="NodePortValueDropdown-trigger" title={title ?? 'View value'}>
				▾
			</summary>
			<pre className="NodePortValueDropdown-panel">{formatPortPreviewValue(value)}</pre>
		</details>
	)
}

async function writeTextToClipboard(text: string): Promise<void> {
	if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text)
		return
	}

	const textArea = document.createElement('textarea')
	textArea.value = text
	textArea.setAttribute('readonly', 'true')
	textArea.style.position = 'fixed'
	textArea.style.opacity = '0'
	textArea.style.pointerEvents = 'none'
	document.body.appendChild(textArea)
	textArea.select()
	document.execCommand('copy')
	document.body.removeChild(textArea)
}

export function CopyTextButton({
	getText,
	title = 'Copy text',
	className,
	disabled = false,
}: {
	getText: () => string
	title?: string
	className?: string
	disabled?: boolean
}) {
	const [copied, setCopied] = useState(false)

	const handlePointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
		event.stopPropagation()
	}, [])

	const handleClick = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
		event.preventDefault()
		event.stopPropagation()
		if (disabled) return

		const text = getText()
		await writeTextToClipboard(text)
		setCopied(true)
		window.setTimeout(() => setCopied(false), 900)
	}, [disabled, getText])

	return (
		<button
			type="button"
			className={classNames('NodeCopyButton', className)}
			title={title}
			disabled={disabled}
			onPointerDown={handlePointerDown}
			onClick={(event) => {
				void handleClick(event)
			}}
		>
			{copied ? 'Copied' : 'Copy'}
		</button>
	)
}

export function PortRenameDialog({
	isOpen,
	title,
	value,
	onChange,
	onCancel,
	onSave,
}: {
	isOpen: boolean
	title: string
	value: string
	onChange: (value: string) => void
	onCancel: () => void
	onSave: () => void
}) {
	const stopPointer = useCallback((event: PointerEvent<HTMLElement>) => {
		event.stopPropagation()
	}, [])

	const stopMouse = useCallback((event: MouseEvent<HTMLElement>) => {
		event.stopPropagation()
	}, [])

	const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
		event.stopPropagation()
		if (event.key === 'Enter') {
			event.preventDefault()
			onSave()
			return
		}
		if (event.key === 'Escape') {
			event.preventDefault()
			onCancel()
		}
	}, [onCancel, onSave])

	if (!isOpen) return null

	return createPortal(
		<div
			className="NodeRenameDialog-backdrop"
			onPointerDown={(event) => {
				event.stopPropagation()
				onCancel()
			}}
			onClick={stopMouse}
		>
			<div
				className="NodeRenameDialog"
				onPointerDown={stopPointer}
				onClick={stopMouse}
			>
				<div className="NodeRenameDialog-title">{title}</div>
				<input
					autoFocus
					className="NodeRenameDialog-input"
					value={value}
					onChange={(event) => onChange(event.target.value)}
					onPointerDown={stopPointer}
					onKeyDown={handleKeyDown}
					placeholder="Enter name"
				/>
				<div className="NodeRenameDialog-actions">
					<button
						type="button"
						className="NodeRenameDialog-btn NodeRenameDialog-btn--ghost"
						onPointerDown={stopPointer}
						onClick={onCancel}
					>
						Cancel
					</button>
					<button
						type="button"
						className="NodeRenameDialog-btn NodeRenameDialog-btn--primary"
						onPointerDown={stopPointer}
						onClick={onSave}
					>
						Save
					</button>
				</div>
			</div>
		</div>
		,
		document.body
	)
}

export function areAnyInputsOutOfDate(inputs: InfoValues): boolean {
	return Object.values(inputs).some((input) => input.isOutOfDate)
}
