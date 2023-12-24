/* @refresh reload */
import {render} from 'solid-js/web'
import {patchObservable} from 'rxjs-traces'
import './console.ts'
import './index.css'
import App from './App'
import {HEADLESS_TEST} from './config.ts'
import {Observable} from 'rxjs'

patchObservable(Observable)

const root = document.getElementById('root')!
render(() => (HEADLESS_TEST ? <div>Headless</div> : <App />), root)
