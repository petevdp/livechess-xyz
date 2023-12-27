/* @refresh reload */
import {render} from 'solid-js/web'
// import {patchObservable} from 'rxjs-traces'
import './console.ts'
import './index.css'
import App from './App'
// import {Observable} from 'rxjs'

// patchObservable(Observable)

const root = document.getElementById('root')!
render(App, root)
