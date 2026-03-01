import { useCallback, useRef, useState } from 'react'
import { T, useEditor } from 'tldraw'
import { FileInputIcon } from '../../components/icons/FileInputIcon'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEIGHT_PX, NODE_WIDTH_PX } from '../../constants'
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

export interface UploadedFileValue {
	__type__: 'uploaded_file'
	kind: 'image' | 'file'
	name: string
	mimeType: string
	sizeBytes: number
	dataBase64: string
}

export type FileInputNode = T.TypeOf<typeof FileInputNode>
export const FileInputNode = T.object({
	type: T.literal('fileInput'),
	fileName: T.string.nullable(),
	mimeType: T.string.nullable(),
	sizeBytes: T.number,
	fileValue: T.any.nullable(),
})

export class FileInputNodeDefinition extends NodeDefinition<FileInputNode> {
	static type = 'fileInput'
	static validator = FileInputNode
	title = 'File Input'
	heading = 'File Input'
	icon = (<FileInputIcon />)

	getDefault(): FileInputNode {
		return {
			type: 'fileInput',
			fileName: null,
			mimeType: null,
			sizeBytes: 0,
			fileValue: null,
		}
	}

	getBodyHeightPx(_shape: NodeShape, _node: FileInputNode) {
		return NODE_ROW_HEIGHT_PX * 2
	}

	getPorts(shape: NodeShape, _node: FileInputNode): Record<string, ShapePort> {
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

	async execute(_shape: NodeShape, node: FileInputNode): Promise<ExecutionResult> {
		return {
			output: node.fileValue,
		}
	}

	getOutputInfo(shape: NodeShape, node: FileInputNode): InfoValues {
		return {
			output: {
				value: node.fileValue,
				isOutOfDate: shape.props.isOutOfDate,
			},
		}
	}

	Component = FileInputNodeComponent
}

export function FileInputNodeComponent({ shape, node }: NodeComponentProps<FileInputNode>) {
	const editor = useEditor()
	const inputRef = useRef<HTMLInputElement | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const onPointerDown = useCallback((event: React.PointerEvent) => {
		editor.markEventAsHandled(event)
		event.stopPropagation()
	}, [editor])

	const openPicker = () => {
		inputRef.current?.click()
	}

	const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		event.target.value = ''
		if (!file) return

		setError(null)
		setIsLoading(true)
		try {
			const dataUrl = await readFileAsDataUrl(file)
			const commaIndex = dataUrl.indexOf(',')
			if (commaIndex < 0) {
				throw new Error('Invalid file encoding')
			}

			const dataBase64 = dataUrl.slice(commaIndex + 1)
			const mimeType = file.type || 'application/octet-stream'
			const kind: UploadedFileValue['kind'] = mimeType.startsWith('image/') ? 'image' : 'file'
			const fileValue: UploadedFileValue = {
				__type__: 'uploaded_file',
				kind,
				name: file.name,
				mimeType,
				sizeBytes: file.size,
				dataBase64,
			}

			updateNode<FileInputNode>(editor, shape, (current) => ({
				...current,
				fileName: file.name,
				mimeType,
				sizeBytes: file.size,
				fileValue,
			}), false)
		} catch (readError) {
			const message = readError instanceof Error ? readError.message : 'Failed to read file.'
			setError(message)
		} finally {
			setIsLoading(false)
		}
	}

	const clearFile = () => {
		setError(null)
		updateNode<FileInputNode>(editor, shape, (current) => ({
			...current,
			fileName: null,
			mimeType: null,
			sizeBytes: 0,
			fileValue: null,
		}), false)
	}

	return (
		<div className="FileInputNode">
			<input
				ref={inputRef}
				type="file"
				onChange={(event) => {
					void onFileChange(event)
				}}
				className="FileInputNode-hiddenInput"
			/>
			<NodeRow className="FileInputNode-row">
				<button
					type="button"
					className="FileInputNode-uploadButton"
					onPointerDown={onPointerDown}
					onClick={openPicker}
					disabled={isLoading}
				>
					{isLoading ? 'Loading...' : node.fileName ? 'Replace File' : 'Import File/Image'}
				</button>
				{node.fileName ? (
					<button
						type="button"
						className="FileInputNode-clearButton"
						onPointerDown={onPointerDown}
						onClick={clearFile}
					>
						Clear
					</button>
				) : null}
			</NodeRow>
			<div className="FileInputNode-meta" onPointerDown={onPointerDown}>
				{node.fileName ? (
					<>
						<div className="FileInputNode-fileName" title={node.fileName}>{node.fileName}</div>
						<div className="FileInputNode-fileInfo">
							{node.mimeType ?? 'application/octet-stream'} • {formatFileSize(node.sizeBytes)}
						</div>
					</>
				) : (
					<div className="FileInputNode-placeholder">No file selected</div>
				)}
				{error ? <div className="FileInputNode-error">{error}</div> : null}
			</div>
		</div>
	)
}

function readFileAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => {
			if (typeof reader.result !== 'string') {
				reject(new Error('Could not read file'))
				return
			}
			resolve(reader.result)
		}
		reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
		reader.readAsDataURL(file)
	})
}

function formatFileSize(sizeBytes: number): string {
	if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '0 B'
	if (sizeBytes < 1024) return `${sizeBytes} B`
	if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
	return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`
}
