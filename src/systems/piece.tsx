import { until } from '@solid-primitives/promise'
import { Component, ComponentProps, createSignal } from 'solid-js'

import bbisphopSrc from '~/assets/pieces/bBishop.svg'
import bbishop from '~/assets/pieces/bBishop.svg?component-solid'
import bkingSrc from '~/assets/pieces/bKing.svg'
import bking from '~/assets/pieces/bKing.svg?component-solid'
import bknightSrc from '~/assets/pieces/bKnight.svg'
import bknight from '~/assets/pieces/bKnight.svg?component-solid'
import bpawnSrc from '~/assets/pieces/bPawn.svg'
import bpawn from '~/assets/pieces/bPawn.svg?component-solid'
import bqueenSrc from '~/assets/pieces/bQueen.svg'
import bqueen from '~/assets/pieces/bQueen.svg?component-solid'
import brookSrc from '~/assets/pieces/bRook.svg'
import brook from '~/assets/pieces/bRook.svg?component-solid'
import duckSrc from '~/assets/pieces/duck.svg'
import duck from '~/assets/pieces/duck.svg?component-solid'
import wbishopSrc from '~/assets/pieces/wBishop.svg'
import wbishop from '~/assets/pieces/wBishop.svg?component-solid'
import wkingSrc from '~/assets/pieces/wKing.svg'
import wking from '~/assets/pieces/wKing.svg?component-solid'
import wknightSrc from '~/assets/pieces/wKnight.svg'
import wknight from '~/assets/pieces/wKnight.svg?component-solid'
import wpawnSrc from '~/assets/pieces/wPawn.svg'
import wpawn from '~/assets/pieces/wPawn.svg?component-solid'
import wqueenSrc from '~/assets/pieces/wQueen.svg'
import wqueen from '~/assets/pieces/wQueen.svg?component-solid'
import wrookSrc from '~/assets/pieces/wRook.svg'
import wrook from '~/assets/pieces/wRook.svg?component-solid'

import * as GL from './game/gameLogic.ts'

const pieceSvgs = {
	wqueen,
	wbishop,
	wking,
	wknight,
	wpawn,
	wrook,
	bqueen,
	bbishop,
	bking,
	bknight,
	bpawn,
	brook,
	duck,
} as const

const pieceSvgSrcs = {
	wqueen: wqueenSrc,
	wbishop: wbishopSrc,
	wking: wkingSrc,
	wknight: wknightSrc,
	wpawn: wpawnSrc,
	wrook: wrookSrc,
	bqueen: bqueenSrc,
	bbishop: bbisphopSrc,
	bking: bkingSrc,
	bknight: bknightSrc,
	bpawn: bpawnSrc,
	brook: brookSrc,
	duck: duckSrc,
} as const

const pieceSvgSrc = {}

export const pieceCache = new Map<string, HTMLImageElement>()

// so we can subscribe to when the pieces are updated
export const [initialized, setInitialized] = createSignal(false)

// TODO insanely inefficient to need to rerun this when squareSize changes, fix
function loadPiece(key: keyof typeof pieceSvgs) {
	const Svg = pieceSvgs[key] as unknown as Component<ComponentProps<'svg'>>
	const svg = (<Svg class="chess-piece" />) as HTMLElement
	const xml = new XMLSerializer().serializeToString(svg)
	const image64 = 'data:image/svg+xml;base64,' + btoa(xml)
	return loadImage(image64, 180)
}

let setupTriggered = false
export function ensureSetupPieceSystem() {
	if (setupTriggered) return
	setupTriggered = true
	for (const key in pieceSvgs) {
		loadPiece(key as keyof typeof pieceSvgs).then((img) => {
			pieceCache.set(key, img)
		})
	}
	setInitialized(true)
}

export function getPieceKey(piece: GL.ColoredPiece) {
	if (piece.type === 'duck') return 'duck'
	const colorPrefix = piece.color === 'white' ? 'w' : 'b'
	return `${colorPrefix}${piece.type}` as keyof typeof pieceSvgs
}

export function getPieceSrc(piece: GL.ColoredPiece) {
	return pieceSvgSrcs[getPieceKey(piece)]
}

export async function getPiece(piece: GL.ColoredPiece, size?: number) {
	const key = getPieceKey(piece)
	if (!size) {
		await until(() => initialized())
		return pieceCache.get(key)!
	}

	return await loadPiece(key as keyof typeof pieceSvgs)
}

export function getCachedPiece(piece: GL.ColoredPiece) {
	return pieceCache.get(getPieceKey(piece))!
}

export function loadImage(src: string, size: number) {
	return new Promise<HTMLImageElement>((resolve) => {
		const img = new Image()
		img.width = size
		img.height = size
		img.src = src
		img.onload = () => {
			resolve(img)
		}
	})
}

export function getPieceSvg(piece: GL.ColoredPiece) {
	return pieceSvgs[getPieceKey(piece)] as unknown as Component<ComponentProps<'svg'>>
}
