/* eslint-disable react-refresh/only-export-components */
import {
	HTMLContainer,
	Rectangle2d,
	ShapeUtil,
	T,
	resizeBox,
	BaseBoxShapeTool,
} from 'tldraw'
import type { Geometry2d, RecordProps, TLResizeInfo, TLShape } from 'tldraw'
import CodeMirror from '@uiw/react-codemirror'                                                                                                         
import { python } from '@codemirror/lang-python'
import { useState } from 'react';

// There's a guide at the bottom of this file!

const CODE_BLOCK_SHAPE = 'code-block-shape'

// [1]
declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		[CODE_BLOCK_SHAPE]: { w: number; h: number; text: string }
	}
}

// [2]
type ICustomShape = TLShape<typeof CODE_BLOCK_SHAPE>

// Functional component for the editor (hooks work here)
function CodeBlockComponent({ shape }: { shape: ICustomShape }) {
	const [code, setCode] = useState(shape.props.text)

	return (
		<HTMLContainer style={{ backgroundColor: '#1e1e1e' }}>
      <CodeMirror
        value={code}
        height="200px"
        extensions={[python()]}                                                                                                                              
        onChange={(value) => setCode(value)}
      />
		</HTMLContainer>
	)
}

// [3]
export class CodeBlockUtil extends ShapeUtil<ICustomShape> {
	// [a]
	static override type = CODE_BLOCK_SHAPE
	static override props: RecordProps<ICustomShape> = {
		w: T.number,
		h: T.number,
		text: T.string,
	}

	// [b]
	getDefaultProps(): ICustomShape['props'] {
		return {
			w: 200,
			h: 200,
			text: "I'm a shape!",
		}
	}

	// [c]
	override canEdit() {
		return false
	}
	override canResize() {
		return true
	}
	override isAspectRatioLocked() {
		return false
	}

	// [d]
	getGeometry(shape: ICustomShape): Geometry2d {
		return new Rectangle2d({
			width: shape.props.w,
			height: shape.props.h,
			isFilled: true,
		})
	}

	// [e]
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	override onResize(shape: any, info: TLResizeInfo<any>) {
		return resizeBox(shape, info)
	}

	// [f] renders actual component
	component(shape: ICustomShape) {
		return <CodeBlockComponent shape={shape} />
	}

	// [g]
	indicator(shape: ICustomShape) {
		return <rect width={shape.props.w} height={shape.props.h} />
	}
}

// Tool for creating CodeBlock shapes
export class CodeBlockTool extends BaseBoxShapeTool {
	static override id = 'code-block'
	static override initial = 'idle'
	override shapeType = CODE_BLOCK_SHAPE as 'code-block-shape'
}

/*
Introduction:

You can create custom shapes in tldraw by creating a shape util and passing it to the Tldraw component.
In this example, we'll create a custom shape that is a simple rectangle with some text inside of it.

[1]
First, we need to extend TLGlobalShapePropsMap to add our shape's props to the global type system.
This tells TypeScript about the shape's properties. For this shape, we define width (w), height (h),
and text as the shape's properties.

[2]
Define the shape type using TLShape with the shape's type as a type argument.

[3]
This is our shape util. In tldraw shape utils are classes that define how a shape behaves and renders.
We can extend the ShapeUtil class and provide the shape type as a generic. If we extended the
BaseBoxShapeUtil class instead, we wouldn't have define methods such as `getGeometry` and `onResize`.

	[a]
	This is where we define out shape's props and type for the editor. It's important to use the same
	string for the type as we did in [2]. We need to define the shape's props using tldraw's validator
	library. The validator will help make sure the store always has shape data we can trust.

	[b]
	This is a method that returns the default props for our shape.

	[c]
	Some handy methods for controlling different shape behaviour. You don't have to define these, and
	they're only shown here so you know they exist. Check out the editable shape example to learn more
	about creating an editable shape.

	[d]
	The getGeometry method is what the editor uses for hit-testing, binding etc. We're using the
	Rectangle2d class from tldraw's geometry library to create a rectangle shape. If we extended the
	BaseBoxShapeUtil class, we wouldn't have to define this method.

	[e]
	We're using the resizeBox utility method to handle resizing our shape. If we extended the
	BaseBoxShapeUtil class, we wouldn't have to define this method.

	[f]
	The component method defines how our shape renders. We're returning an HTMLContainer here, which
	is a handy component that tldraw exports. It's essentially a div with some special css. There's a
	lot of flexibility here, and you can use any React hooks you want and return any valid JSX.

	[g]
	The indicator is the blue outline around a selected shape. We're just returning a rectangle with the
	same width and height as the shape here. You can return any valid JSX here.

[4]
This is where we render the Tldraw component with our custom shape. We're passing in our custom shape
util as an array to the shapeUtils prop. We're also using the onMount callback to create a shape on
the canvas. If you want to learn how to add a tool for your shape, check out the custom config example.
If you want to learn how to programmatically control the canvas, check out the Editor API examples.

*/
