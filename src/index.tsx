/* @refresh reload */
import { H } from 'highlight.run'
import 'solid-devtools'
import { render } from 'solid-js/web'

import App from './App'
import './index.css'

console.debug({
	VITE_GIT_COMMIT_DATE: import.meta.env.VITE_GIT_COMMIT_DATE,
	VITE_GIT_BRANCH_NAME: import.meta.env.VITE_GIT_BRANCH_NAME,
	VITE_GIT_COMMIT_HASH: import.meta.env.VITE_GIT_COMMIT_HASH,
	VITE_GIT_LAST_COMMIT_MESSAGE: import.meta.env.VITE_GIT_LAST_COMMIT_MESSAGE,
	PROD: import.meta.env.PROD,
})

if (!import.meta.env.PROD) {
	import('./console.ts')
}

H.init(import.meta.env.VITE_HIGHLIGHT_PROJECT_ID, {
	environment: 'production',
	version: import.meta.env.VITE_GIT_COMMIT_HASH,
	networkRecording: {
		enabled: true,
		recordHeadersAndBody: true,
	},
})

const root = document.getElementById('root')!
render(App, root)
