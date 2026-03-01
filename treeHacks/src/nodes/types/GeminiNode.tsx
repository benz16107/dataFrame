import { useCallback, useState } from 'react'
import { Editor, getIndexAbove, IndexKey, T, useEditor, useValue } from 'tldraw'
import { GeminiIcon } from '../../components/icons/GeminiIcon'
import {
	NODE_ROW_BOTTOM_PADDING_PX,
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_HEADER_GAP_PX,
	NODE_ROW_HEIGHT_PX,
	NODE_WIDTH_PX,
} from '../../constants'
import { Port, ShapePort } from '../../ports/Port'
import { indexList, indexListEntries, indexListLength } from '../../utils'
import { getApiBaseUrl } from '../../lib/auth'
import { getNodeInputPortValues, getNodePortConnections } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import {
	areAnyInputsOutOfDate,
	CopyTextButton,
	ExecutionResult,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	PortRenameDialog,
	PortValueDropdown,
	STOP_EXECUTION,
	updateNode,
} from './shared'

const API_BASE = getApiBaseUrl()

export type GeminiNode = T.TypeOf<typeof GeminiNode>
export const GeminiNode = T.object({
	type: T.literal('gemini'),
	prompt: T.string,
	inputs: T.dict(T.indexKey, T.any),
	outputs: T.dict(T.indexKey, T.any),
	inputLabels: T.dict(T.indexKey, T.string),
	outputLabels: T.dict(T.indexKey, T.string),
	lastInput: T.string.nullable(),
	lastPrompt: T.string.nullable(),
	lastRequest: T.string.nullable(),
	lastResponse: T.string.nullable(),
	lastReply: T.string.nullable(),
	lastOutput: T.any.nullable(),
	lastError: T.string.nullable(),
})

export class GeminiNodeDefinition extends NodeDefinition<GeminiNode> {
	static type = 'gemini'
	static validator = GeminiNode
	title = 'Gemini'
	heading = 'Gemini'
	icon = (<GeminiIcon />)

	getDefault(): GeminiNode {
		return {
			type: 'gemini',
			prompt: '',
			inputs: indexList([null]),
			outputs: indexList([null]),
			inputLabels: {},
			outputLabels: {},
			lastInput: null,
			lastPrompt: null,
			lastRequest: null,
			lastResponse: null,
			lastReply: null,
			lastOutput: null,
			lastError: null,
		}
	}

	getBodyHeightPx(shape: NodeShape, node: GeminiNode) {
		const ioRows = Math.max(indexListLength(node.inputs), indexListLength(node.outputs)) + 1
		const contentRows = 8
		const baseBodyHeight = NODE_ROW_HEIGHT_PX * (ioRows + contentRows)
		const overrideBodyHeight = Math.max(
			0,
			(shape.props.h || 0) - NODE_HEADER_HEIGHT_PX - NODE_ROW_HEADER_GAP_PX - NODE_ROW_BOTTOM_PADDING_PX
		)
		return Math.max(baseBodyHeight, overrideBodyHeight)
	}

	getPorts(shape: NodeShape, node: GeminiNode): Record<string, ShapePort> {
		const width = Math.max(NODE_WIDTH_PX, shape.props.w || NODE_WIDTH_PX)
		const ports: Record<string, ShapePort> = {}

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

		Object.keys(node.outputs)
			.sort()
			.forEach((idx, i) => {
				ports[`output_${idx}`] = {
					id: `output_${idx}`,
					x: width,
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

	async execute(shape: NodeShape, node: GeminiNode, inputs: InputValues): Promise<ExecutionResult> {
		const namedInputs: Record<string, unknown> = {}
		const sortedInputKeys = Object.keys(node.inputs).sort()
		sortedInputKeys.forEach((idx, i) => {
			const portId = `input_${idx}`
			namedInputs[getInputVariableName(i)] = inputs[portId] ?? node.inputs[idx as IndexKey] ?? null
		})

		return runGemini(shape, node, this.editor, namedInputs)
	}

	getOutputInfo(shape: NodeShape, node: GeminiNode, inputs: InfoValues): InfoValues {
		const result: InfoValues = {}
		Object.keys(node.outputs).forEach((idx) => {
			result[`output_${idx}`] = {
				value: node.outputs[idx as IndexKey] ?? null,
				isOutOfDate: shape.props.isOutOfDate || areAnyInputsOutOfDate(inputs),
			}
		})
		return result
	}

	Component = GeminiNodeComponent
}

export function GeminiNodeComponent({ shape, node }: NodeComponentProps<GeminiNode>) {
	const editor = useEditor()
	const [isRunning, setIsRunning] = useState(false)
	const [renameTarget, setRenameTarget] = useState<{
		kind: 'input' | 'output'
		idx: IndexKey
		rowIndex: number
	} | null>(null)
	const [renameValue, setRenameValue] = useState('')

	const stopPointer = useCallback((event: React.PointerEvent) => {
		event.stopPropagation()
	}, [])

	const stopPointerHandled = useCallback((event: React.PointerEvent) => {
		editor.markEventAsHandled(event)
		event.stopPropagation()
	}, [editor])

	const stopMouseHandled = useCallback((event: React.MouseEvent) => {
		editor.markEventAsHandled(event)
		event.stopPropagation()
	}, [editor])

	const stopWheel = useCallback((event: React.WheelEvent) => {
		event.stopPropagation()
	}, [])

	const stopKeyDown = useCallback((event: React.KeyboardEvent) => {
		event.stopPropagation()
	}, [])

	const connectedInputValue = useValue(
		'gemini input values',
		() => {
			const values = getNodeInputPortValues(editor, shape.id)
			const namedInputs: Record<string, unknown> = {}
			Object.keys(node.inputs)
				.sort()
				.forEach((idx, i) => {
					const portId = `input_${idx}`
					const input = values[portId]
					namedInputs[getInputVariableName(i)] =
						!input || input.value === STOP_EXECUTION
							? node.inputs[idx as IndexKey] ?? null
							: input.value
				})
			return namedInputs
		},
		[editor, node.inputs, shape.id]
	)

	const inputPortValues = useValue('gemini input port values', () => getNodeInputPortValues(editor, shape.id), [
		editor,
		shape.id,
	])

	const handleRun = useCallback(async () => {
		if (isRunning) return

		setIsRunning(true)
		try {
			await runGemini(shape, node, editor, connectedInputValue)
		} finally {
			setIsRunning(false)
		}
	}, [connectedInputValue, editor, isRunning, shape])

	const handleAddInput = useCallback(() => {
		updateNode<GeminiNode>(editor, shape, (current) => ({
			...current,
			inputs: appendGeminiIoItem(current.inputs, null),
		}), false)
	}, [editor, shape])

	const handleAddOutput = useCallback(() => {
		updateNode<GeminiNode>(editor, shape, (current) => ({
			...current,
			outputs: appendGeminiIoItem(current.outputs, null),
		}), false)
	}, [editor, shape])

	const handleRemoveInput = useCallback(
		(idx: IndexKey) => {
			const entries = indexListEntries(node.inputs)
			if (entries.length <= 1 || idx === entries[0][0]) return

			const removedPortId = `input_${idx}`
			const connectionIds = getNodePortConnections(editor, shape.id)
				.filter((connection) => connection.ownPortId === removedPortId)
				.map((connection) => connection.connectionId)

			if (connectionIds.length > 0) editor.deleteShapes(connectionIds)

			updateNode<GeminiNode>(editor, shape, (current) => {
				const nextInputs = { ...current.inputs }
				const nextInputLabels = { ...current.inputLabels }
				delete nextInputs[idx]
				delete nextInputLabels[idx]
				return { ...current, inputs: nextInputs, inputLabels: nextInputLabels }
			}, false)
		},
		[editor, node.inputs, shape]
	)

	const handleRemoveOutput = useCallback(
		(idx: IndexKey) => {
			const entries = indexListEntries(node.outputs)
			if (entries.length <= 1 || idx === entries[0][0]) return

			const removedPortId = `output_${idx}`
			const connectionIds = getNodePortConnections(editor, shape.id)
				.filter((connection) => connection.ownPortId === removedPortId)
				.map((connection) => connection.connectionId)

			if (connectionIds.length > 0) editor.deleteShapes(connectionIds)

			updateNode<GeminiNode>(editor, shape, (current) => {
				const nextOutputs = { ...current.outputs }
				const nextOutputLabels = { ...current.outputLabels }
				delete nextOutputs[idx]
				delete nextOutputLabels[idx]
				return { ...current, outputs: nextOutputs, outputLabels: nextOutputLabels }
			}, false)
		},
		[editor, node.outputs, shape]
	)

	const openRenameDialog = useCallback(
		(kind: 'input' | 'output', idx: IndexKey, rowIndex: number) => {
			const defaultName = kind === 'input' ? getInputDisplayName(rowIndex) : getOutputDisplayName(rowIndex)
			const labels = kind === 'input' ? node.inputLabels : node.outputLabels
			setRenameValue((labels[idx] ?? defaultName).trim())
			setRenameTarget({ kind, idx, rowIndex })
		},
		[node.inputLabels, node.outputLabels]
	)

	const closeRenameDialog = useCallback(() => {
		setRenameTarget(null)
		setRenameValue('')
	}, [])

	const saveRenameDialog = useCallback(() => {
		if (!renameTarget) return

		const trimmedName = renameValue.trim()
		const { kind, idx } = renameTarget
		updateNode<GeminiNode>(editor, shape, (current) => {
			if (kind === 'input') {
				const nextInputLabels = { ...current.inputLabels }
				if (trimmedName.length === 0) {
					delete nextInputLabels[idx]
				} else {
					nextInputLabels[idx] = trimmedName
				}
				return { ...current, inputLabels: nextInputLabels }
			}

			const nextOutputLabels = { ...current.outputLabels }
			if (trimmedName.length === 0) {
				delete nextOutputLabels[idx]
			} else {
				nextOutputLabels[idx] = trimmedName
			}
			return { ...current, outputLabels: nextOutputLabels }
		}, false)

		closeRenameDialog()
	}, [closeRenameDialog, editor, renameTarget, renameValue, shape])

	const handleClear = useCallback(() => {
		const resetOutputs = Object.fromEntries(
			indexListEntries(node.outputs).map(([idx]) => [idx, null])
		) as Record<IndexKey, unknown>

		updateNode<GeminiNode>(editor, shape, (n) => ({
			...n,
			outputs: resetOutputs,
			lastInput: null,
			lastPrompt: null,
			lastRequest: null,
			lastResponse: null,
			lastReply: null,
			lastOutput: null,
			lastError: null,
		}), false)
	}, [editor, node.outputs, shape])

	const responseText = node.lastResponse ?? node.lastReply ?? 'No response yet'

	return (
		<div className="GeminiNodeSimple" style={{ pointerEvents: 'all' }}>
			<div className="GeminiNodeSimple-shell" style={{ pointerEvents: 'all' }}>
				<div className="GeminiNodeSimple-ports">
					<div className="GeminiNodeSimple-inputs">
						{indexListEntries(node.inputs).map(([idx], rowIndex) => {
							const isFirst = rowIndex === 0
							const inputPortId = `input_${idx}`
							const inputLabel = getCustomPortDisplayName(node.inputLabels, idx, rowIndex, 'input')
							const connectedInput = inputPortValues[inputPortId]
							const previewInputValue =
								connectedInput?.value === STOP_EXECUTION
									? STOP_EXECUTION
									: connectedInput?.value ?? node.inputs[idx as IndexKey] ?? null
							return (
								<div key={idx} className="GeminiNodeSimple-portRow">
									<Port shapeId={shape.id} portId={`input_${idx}`} />
									<span className="GeminiNodeSimple-portLabel">{inputLabel}</span>
									<button
										type="button"
										className="CodeNode-inline-rename"
										onPointerDown={stopPointerHandled}
										onClick={() => openRenameDialog('input', idx, rowIndex)}
										title={`Rename ${inputLabel}`}
									>
										✎
									</button>
									<PortValueDropdown
										title={`${inputLabel} value`}
										value={previewInputValue}
									/>
									{!isFirst && (
										<button
											type="button"
											className="CodeNode-inline-remove"
											onPointerDown={stopPointer}
											onClick={() => handleRemoveInput(idx)}
											title="Remove input"
										>
											×
										</button>
									)}
								</div>
							)
						})}
						<div className="GeminiNodeSimple-portControls">
							<button
								type="button"
								className="CodeNode-add-io-button"
								onPointerDown={stopPointer}
								onClick={handleAddInput}
							>
								+ Add input
							</button>
						</div>
					</div>

					<div className="GeminiNodeSimple-outputs">
						{indexListEntries(node.outputs).map(([idx], rowIndex) => {
							const isFirst = rowIndex === 0
							const outputLabel = getCustomPortDisplayName(node.outputLabels, idx, rowIndex, 'output')
							const previewOutputValue = node.outputs[idx as IndexKey] ?? null
							return (
								<div key={idx} className="GeminiNodeSimple-portRow GeminiNodeSimple-portRow--output">
									{!isFirst && (
										<button
											type="button"
											className="CodeNode-inline-remove"
											onPointerDown={stopPointer}
											onClick={() => handleRemoveOutput(idx)}
											title="Remove output"
										>
											×
										</button>
									)}
									<PortValueDropdown
										title={`${outputLabel} value`}
										value={previewOutputValue}
										align="right"
									/>
									<button
										type="button"
										className="CodeNode-inline-rename"
										onPointerDown={stopPointerHandled}
										onClick={() => openRenameDialog('output', idx, rowIndex)}
										title={`Rename ${outputLabel}`}
									>
										✎
									</button>
									<span className="GeminiNodeSimple-portLabel">{outputLabel}</span>
									<Port shapeId={shape.id} portId={`output_${idx}`} />
								</div>
							)
						})}
						<div className="GeminiNodeSimple-portControls GeminiNodeSimple-portControls--output">
							<button
								type="button"
								className="CodeNode-add-io-button"
								onPointerDown={stopPointer}
								onClick={handleAddOutput}
							>
								+ Add output
							</button>
						</div>
					</div>
				</div>

				<div className="GeminiNodeSimple-card CodeNode-ai-assist" onPointerDown={stopPointer}>
					<div className="GeminiNodeSimple-labelRow CodeNode-ai-header">
						<div className="GeminiNodeSimple-label">Prompt</div>
						<CopyTextButton
							title="Copy prompt"
							getText={() => node.prompt}
							className="CodeNode-copy-button"
						/>
					</div>
					<textarea
						className="GeminiNodeSimple-prompt CodeNode-ai-prompt"
						value={node.prompt}
						onChange={(event) =>
							updateNode<GeminiNode>(editor, shape, (n) => ({
								...n,
								prompt: event.target.value,
							}), false)
						}
						onFocus={() => editor.setSelectedShapes([shape.id])}
						placeholder="Write instructions for Gemini"
						onPointerDown={stopPointer}
						onKeyDown={stopKeyDown}
					/>
				</div>

				<div className="GeminiNodeSimple-actions CodeNode-header-actions" onPointerDown={stopPointer}>
						<button
							type="button"
							className="CodeNode-clear-button"
							onClick={handleClear}
							onPointerDown={stopPointer}
							disabled={isRunning}
						>
							Clear
						</button>
						<button
							type="button"
							className="CodeNode-run-button"
							onClick={handleRun}
							onPointerDown={stopPointer}
							disabled={isRunning}
						>
							{isRunning ? 'Running...' : 'Run'}
						</button>
				</div>

				<div className="GeminiNodeSimple-panel CodeNode-console">
					<div className="GeminiNodeSimple-panelTitle CodeNode-console-header">
						<span>Response</span>
						<CopyTextButton
							title="Copy response"
							getText={() => responseText}
							className="CodeNode-copy-button"
						/>
					</div>
					<div
						className="GeminiNodeSimple-panelBody CodeNode-console-output"
						onPointerDownCapture={stopPointerHandled}
						onMouseDownCapture={stopMouseHandled}
						onWheelCapture={stopWheel}
					>
						{responseText}
					</div>
				</div>

				<PortRenameDialog
					isOpen={renameTarget !== null}
					title={
						renameTarget
							? `Rename ${
								renameTarget.kind === 'input'
									? getInputDisplayName(renameTarget.rowIndex)
									: getOutputDisplayName(renameTarget.rowIndex)
							}`
							: 'Rename port'
					}
					value={renameValue}
					onChange={setRenameValue}
					onCancel={closeRenameDialog}
					onSave={saveRenameDialog}
				/>
			</div>
		</div>
	)
}

async function runGemini(
	shape: NodeShape,
	node: GeminiNode,
	editor: Editor,
	namedInputs: Record<string, unknown>
): Promise<ExecutionResult> {
	const preparedInputs = prepareGeminiRequestInputs(namedInputs)
	const hasInput = preparedInputs.summaryLines.length > 0
	const inputText = hasInput ? preparedInputs.summaryLines.join('\n') : ''
	const promptText = node.prompt.trim() || 'Generate a concise response.'
	const requestText = hasInput ? `${promptText}\n\nInputs:\n${inputText}` : promptText

	const sortedOutputKeys = Object.keys(node.outputs).sort()
	const outputNames = sortedOutputKeys.map((_idx, i) => getOutputVariableName(i))

	try {
		const response = await fetch(`${API_BASE}/api/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({
				message: requestText,
				prompt: promptText,
				inputs: preparedInputs.apiInputs,
			}),
		})

		if (!response.ok) {
			let detail = `HTTP ${response.status}`
			try {
				const errorData = (await response.json()) as { detail?: string }
				if (errorData.detail) detail = errorData.detail
			} catch {
				// ignore JSON parse errors and keep default status detail
			}
			throw new Error(detail)
		}

		const data = (await response.json()) as { reply?: string; output?: unknown }
		const reply = (data.reply ?? '').trim()
		const outputValue = normalizeGeminiOutputValue(data.output, reply)
		const mappedOutputs = mapGeminiOutputs(outputValue, outputNames)
		const outputValuesByKey = Object.fromEntries(
			sortedOutputKeys.map((idx, i) => [idx, mappedOutputs[getOutputVariableName(i)] ?? null])
		) as Record<IndexKey, unknown>
		const firstOutput = mappedOutputs[getOutputVariableName(0)] ?? null
		const outputText = reply || formatOutputForDisplay(outputValue) || 'No response text returned.'

		updateNode<GeminiNode>(editor, shape, (n) => ({
			...n,
			outputs: outputValuesByKey,
			lastInput: hasInput ? (inputText || '(empty)') : '(none)',
			lastPrompt: promptText,
			lastRequest: requestText,
			lastResponse: outputText,
			lastReply: outputText,
			lastOutput: firstOutput,
			lastError: null,
		}), false)

		return Object.fromEntries(
			sortedOutputKeys.map((idx, i) => [`output_${idx}`, mappedOutputs[getOutputVariableName(i)] ?? null])
		)
	} catch (error) {
		const detail = error instanceof Error ? error.message : 'Unknown Gemini error'
		const errorReply = `Error: ${detail}`

		updateNode<GeminiNode>(editor, shape, (n) => ({
			...n,
			outputs: Object.fromEntries(sortedOutputKeys.map((idx) => [idx, errorReply])) as Record<
				IndexKey,
				unknown
			>,
			lastInput: hasInput ? (inputText || '(empty)') : '(none)',
			lastPrompt: promptText,
			lastRequest: requestText,
			lastResponse: null,
			lastReply: errorReply,
			lastOutput: errorReply,
			lastError: detail,
		}), false)

		return Object.fromEntries(sortedOutputKeys.map((idx) => [`output_${idx}`, errorReply]))
	}
}

function mapGeminiOutputs(outputValue: unknown, outputNames: string[]): Record<string, unknown> {
	if (outputNames.length === 0) return {}

	if (Array.isArray(outputValue)) {
		if (outputNames.length === 1) {
			return { [outputNames[0]]: outputValue }
		}
		return Object.fromEntries(outputNames.map((name, i) => [name, outputValue[i] ?? null]))
	}

	if (isPlainObject(outputValue)) {
		const objectValue = outputValue as Record<string, unknown>
		const hasNamedOutputs = outputNames.some((name) => Object.hasOwn(objectValue, name))
		if (hasNamedOutputs) {
			return Object.fromEntries(outputNames.map((name) => [name, objectValue[name] ?? null]))
		}

		if (outputNames.length >= 2) {
			const hasXy = Object.hasOwn(objectValue, 'x') && Object.hasOwn(objectValue, 'y')
			if (hasXy) {
				const mapped: Record<string, unknown> = Object.fromEntries(outputNames.map((name) => [name, null]))
				mapped[outputNames[0]] = objectValue.x ?? null
				mapped[outputNames[1]] = objectValue.y ?? null
				return mapped
			}

			const hasBarSeries = Object.hasOwn(objectValue, 'labels') && Object.hasOwn(objectValue, 'values')
			if (hasBarSeries) {
				const mapped: Record<string, unknown> = Object.fromEntries(outputNames.map((name) => [name, null]))
				mapped[outputNames[0]] = objectValue.labels ?? null
				mapped[outputNames[1]] = objectValue.values ?? null
				return mapped
			}

			const hasSingleBar = Object.hasOwn(objectValue, 'label') && Object.hasOwn(objectValue, 'value')
			if (hasSingleBar) {
				const mapped: Record<string, unknown> = Object.fromEntries(outputNames.map((name) => [name, null]))
				mapped[outputNames[0]] = objectValue.label ?? null
				mapped[outputNames[1]] = objectValue.value ?? null
				return mapped
			}
		}
	}

	return Object.fromEntries(outputNames.map((name, i) => [name, i === 0 ? outputValue : null]))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface UploadedFileInputValue {
	__type__: 'uploaded_file'
	kind: 'image' | 'file'
	name: string
	mimeType: string
	sizeBytes: number
	dataBase64: string
}

function isUploadedFileInputValue(value: unknown): value is UploadedFileInputValue {
	if (!isPlainObject(value)) return false
	return (
		value.__type__ === 'uploaded_file' &&
		(typeof value.kind === 'string') &&
		(typeof value.name === 'string') &&
		(typeof value.mimeType === 'string') &&
		(typeof value.dataBase64 === 'string')
	)
}

function prepareGeminiRequestInputs(namedInputs: Record<string, unknown>) {
	const summaryLines: string[] = []
	const apiInputs: Array<{
		type: 'image' | 'file'
		name: string
		mimeType: string
		dataBase64: string
	} | {
		type: 'text'
		name: string
		value: string
	}> = []

	for (const [name, value] of Object.entries(namedInputs)) {
		if (value === null || value === undefined) continue

		if (isUploadedFileInputValue(value)) {
			const sizeLabel = Number.isFinite(value.sizeBytes)
				? `${(value.sizeBytes / 1024).toFixed(1)} KB`
				: 'unknown size'
			summaryLines.push(`${name}: [${value.kind}] ${value.name} (${value.mimeType}, ${sizeLabel})`)
			apiInputs.push({
				type: value.kind,
				name: value.name,
				mimeType: value.mimeType,
				dataBase64: value.dataBase64,
			})
			continue
		}

		const textValue = stringifyInput(value)
		if (textValue.trim() === '') continue
		summaryLines.push(`${name}: ${textValue}`)
		apiInputs.push({
			type: 'text',
			name,
			value: textValue,
		})
	}

	return { summaryLines, apiInputs }
}

function stringifyInput(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

function formatOutputForDisplay(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	try {
		return JSON.stringify(value, null, 2)
	} catch {
		return String(value)
	}
}

function coerceStringToValue(text: string): unknown {
	const value = text.trim()
	if (!value) return ''

	try {
		return JSON.parse(value)
	} catch {
		// continue to literal coercions
	}

	const lowered = value.toLowerCase()
	if (lowered === 'none' || lowered === 'null') return null
	if (lowered === 'true') return true
	if (lowered === 'false') return false

	if (/^-?\d+$/.test(value)) {
		const parsedInt = Number(value)
		if (Number.isSafeInteger(parsedInt)) return parsedInt
	}

	if (/^-?(?:\d+\.\d+|\d+\.|\.\d+)(?:e[-+]?\d+)?$/i.test(value)) {
		const parsedFloat = Number(value)
		if (Number.isFinite(parsedFloat)) return parsedFloat
	}

	return value
}

function normalizeGeminiOutputValue(rawOutput: unknown, reply: string): unknown {
	if (rawOutput !== undefined) {
		if (typeof rawOutput !== 'string') return rawOutput
		return coerceStructuredString(rawOutput)
	}

	return coerceStructuredString(reply)
}

function coerceStructuredString(text: string): unknown {
	const direct = coerceStringToValue(text)
	if (direct !== text) return direct

	const fragment = extractBalancedStructuredFragment(text)
	if (!fragment) return text

	const parsed = coerceStringToValue(fragment)
	return parsed
}

function extractBalancedStructuredFragment(text: string): string | null {
	const source = text.trim()
	if (!source.includes('{') && !source.includes('[')) return null

	const collect = (openChar: '{' | '[', closeChar: '}' | ']'): string | null => {
		const start = source.indexOf(openChar)
		if (start < 0) return null

		let depth = 0
		let inString = false
		let quote: '"' | "'" | '' = ''
		let escaped = false

		for (let index = start; index < source.length; index += 1) {
			const char = source[index]

			if (inString) {
				if (escaped) {
					escaped = false
					continue
				}
				if (char === '\\\\') {
					escaped = true
					continue
				}
				if (char === quote) {
					inString = false
					quote = ''
				}
				continue
			}

			if (char === '"' || char === "'") {
				inString = true
				quote = char
				continue
			}

			if (char === openChar) {
				depth += 1
				continue
			}

			if (char === closeChar) {
				depth -= 1
				if (depth === 0) {
					return source.slice(start, index + 1)
				}
			}
		}

		return null
	}

	const objectCandidate = collect('{', '}')
	const arrayCandidate = collect('[', ']')

	if (objectCandidate && arrayCandidate) {
		return objectCandidate.length >= arrayCandidate.length ? objectCandidate : arrayCandidate
	}

	return objectCandidate ?? arrayCandidate
}

function appendGeminiIoItem(items: Record<IndexKey, unknown>, value: unknown) {
	const entries = indexListEntries(items)
	if (entries.length === 0) return indexList([value])
	const lastIndex = entries[entries.length - 1][0]
	const newIndex = getIndexAbove(lastIndex)
	return {
		...items,
		[newIndex]: value,
	}
}

function getInputDisplayName(index: number): string {
	return index === 0 ? 'input' : `input${index + 1}`
}

function getOutputDisplayName(index: number): string {
	return index === 0 ? 'output' : `output${index + 1}`
}

function getInputVariableName(index: number): string {
	return index === 0 ? 'input' : `input${index + 1}`
}

function getOutputVariableName(index: number): string {
	return index === 0 ? 'output' : `output${index + 1}`
}

function getCustomPortDisplayName(
	labels: Record<IndexKey, string>,
	idx: IndexKey,
	index: number,
	kind: 'input' | 'output'
): string {
	const customLabel = labels[idx]?.trim()
	if (customLabel) return customLabel
	return kind === 'input' ? getInputDisplayName(index) : getOutputDisplayName(index)
}
