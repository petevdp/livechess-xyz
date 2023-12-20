/* @refresh reload */
import {render} from 'solid-js/web'
import './console.ts'
import './index.css'
import App from './App'
import {HEADLESS_TEST} from "./config.ts";

const root = document.getElementById('root')!;
render(() => HEADLESS_TEST ? <div>Headless</div> : <App/>, root)
