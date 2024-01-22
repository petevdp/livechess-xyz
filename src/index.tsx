/* @refresh reload */
import 'solid-devtools';
import { render } from 'solid-js/web';



import App from './App';
import './index.css'


if (!import.meta.env.PROD) {
	import('./console.ts')
}

const root = document.getElementById('root')!
render(App, root)
