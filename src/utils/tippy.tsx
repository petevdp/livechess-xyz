import tippyJs from 'tippy.js'
import 'tippy.js/dist/tippy.css'
import { Accessor } from 'solid-js' // optional for styling

export function tippy(elt: HTMLElement, props: Accessor<Parameters<typeof tippyJs>[1]>) {
	tippyJs(elt, props())
}
