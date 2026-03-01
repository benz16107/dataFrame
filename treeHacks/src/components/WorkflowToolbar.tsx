import {
	createShapeId,
	DefaultToolbar,
	DrawToolbarItem,
	Editor,
	HandToolbarItem,
	NoteToolbarItem,
	onDragFromToolbarToCreateShape,
	SelectToolbarItem,
	TldrawUiMenuGroup,
	TLShapeId,
	TLUiOverrides,
	ToolbarItem,
	Vec,
} from 'tldraw'
import { NodeShape } from '../nodes/NodeShapeUtil'
import { getNodeDefinitions, NodeType } from '../nodes/nodeTypes'

function createNodeShape(editor: Editor, shapeId: TLShapeId, center: Vec, node: NodeType) {
	// Mark a history stopping point for undo/redo
	const markId = editor.markHistoryStoppingPoint('create node')

	editor.run(() => {
		// Create the shape with the node definition
		editor.createShape({
			id: shapeId,
			type: 'node',
			props: { node },
		})

		// Get the created shape and its bounds
		const shape = editor.getShape<NodeShape>(shapeId)!
		const shapeBounds = editor.getShapePageBounds(shapeId)!

		// Position the shape so its center aligns with the drop point
		const x = center.x - shapeBounds.width / 2
		const y = center.y - shapeBounds.height / 2
		editor.updateShape({ ...shape, x, y })

		// Select the newly created shape
		editor.select(shapeId)
	})

	return markId
}

export const overrides: TLUiOverrides = {
	tools: (editor, tools, _) => {
		for (const nodeDef of Object.values(getNodeDefinitions(editor))) {
			tools[`node-${nodeDef.type}`] = {
				id: `node-${nodeDef.type}`,
				label: nodeDef.title,
				icon: nodeDef.icon,
				onSelect: () => {
					createNodeShape(
						editor,
						createShapeId(),
						editor.getViewportPageBounds().center,
						nodeDef.getDefault()
					)
				},
				onDragStart: (_, info) => {
					onDragFromToolbarToCreateShape(editor, info, {
						createShape: (id) => {
							editor.createShape({
								id,
								type: 'node',
								props: { node: nodeDef.getDefault() },
							})
						},
					})
				},
			}
		}
		return tools
	},
}

export function WorkflowToolbar() {
	return (
		<DefaultToolbar orientation="vertical" maxItems={12}>
			<TldrawUiMenuGroup id="selection">
				<SelectToolbarItem />
				<HandToolbarItem />
				<DrawToolbarItem />
				<NoteToolbarItem />
			</TldrawUiMenuGroup>

			<TldrawUiMenuGroup id="nodes">
				<ToolbarItem tool="node-fileInput" />
				<ToolbarItem tool="node-code" />
				<ToolbarItem tool="node-textOutput" />
				<ToolbarItem tool="node-numberOutput" />
				<ToolbarItem tool="node-output" />
				<ToolbarItem tool="node-plot" />
				<ToolbarItem tool="node-gemini" />
				<ToolbarItem tool="node-slider" />
			</TldrawUiMenuGroup>

		</DefaultToolbar>
	)
}
