/* @refresh reload */
import 'solid-devtools'
import { render } from 'solid-js/web'

import App from './App'
import './console.ts';
import './index.css';


const root = document.getElementById('root')!
render(App, root)
