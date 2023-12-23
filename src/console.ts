import * as R from './systems/room.ts'
import * as G from './systems/game/game.ts'
import * as P from './systems/player.ts'
import * as M from './components/Modal.tsx'
import { createEffect, createRoot, getOwner } from 'solid-js'
import { until } from '@solid-primitives/promise'
import * as yUtils from './utils/yjs.ts'
import { unwrap } from 'solid-js/store'

const appConsole = {
	R,
	G,
	P,
	M,
}

const utils = {
	createRoot,
	getOwner,
	createEffect,
	until,
	yUtils,
	unwrap,
}

export type AppConsole = typeof appConsole
export type UtilsConsole = typeof utils

if (window) {
	// @ts-ignore
	window.App = appConsole
	// @ts-ignore
	window.Utils = utils
}
