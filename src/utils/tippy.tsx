import 'tippy.js/dist/tippy.css'
import 'tippy.js/themes/material.css'
import tippyJs from 'tippy.js'

// this exists so we always include the relevant css and default properties for tippy
export function tippy(elt: HTMLElement, props: Parameters<typeof tippyJs>[1]) {
	return tippyJs(elt, {...props, theme: 'material'})
}
