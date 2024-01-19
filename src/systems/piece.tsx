import { until } from '@solid-primitives/promise'
import { Component, ComponentProps, createEffect, createSignal } from 'solid-js'

import bbishop from '~/assets/pieces/bBishop.svg'
import bking from '~/assets/pieces/bKing.svg'
import bknight from '~/assets/pieces/bKnight.svg'
import bpawn from '~/assets/pieces/bPawn.svg'
import bqueen from '~/assets/pieces/bQueen.svg'
import brook from '~/assets/pieces/bRook.svg'
import duck from '~/assets/pieces/duck.svg'
import wbishop from '~/assets/pieces/wBishop.svg'
import wking from '~/assets/pieces/wKing.svg'
import wknight from '~/assets/pieces/wKnight.svg'
import wpawn from '~/assets/pieces/wPawn.svg'
import wqueen from '~/assets/pieces/wQueen.svg'
import wrook from '~/assets/pieces/wRook.svg'

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

export const pieceCache = new Map<string, HTMLImageElement>()

export const [squareSize, setSquareSize] = createSignal(32)

// so we can subscribe to when the pieces are updated
export const [pieceChangedEpoch, setPiecedChangedEpoch] = createSignal(0)
export const initialized = () => pieceCache.size > 0

function loadPiece(key: keyof typeof pieceSvgs, squareSize: number) {
	const Svg = pieceSvgs[key]
	//@ts-ignore
	const svg = (<Svg class="chess-piece" width={squareSize} height={squareSize} />) as HTMLElement
	const xml = new XMLSerializer().serializeToString(svg)
	const image64 = 'data:image/svg+xml;base64,' + btoa(xml)
	return loadImage(image64, 180)
}

export function setupPieceSystem() {
	createEffect(() => {
		let promises: Promise<void>[] = []
		for (const key in pieceSvgs) {
			promises.push(
				loadPiece(key as keyof typeof pieceSvgs, squareSize()).then((img) => {
					pieceCache.set(key, img)
				})
			)
		}

		if (initialized()) return
		Promise.all(promises).then(() => {
			setPiecedChangedEpoch((epoch) => epoch + 1)
		})
	})
}

function getPieceKey(piece: GL.ColoredPiece) {
	if (piece.type === 'duck') return 'duck'
	const colorPrefix = piece.color === 'white' ? 'w' : 'b'
	return `${colorPrefix}${piece.type}` as keyof typeof pieceSvgs
}

export function getPieceSrc(piece: GL.ColoredPiece) {
	return pieceSvgs[getPieceKey(piece)]
}

export async function getPiece(piece: GL.ColoredPiece, size?: number) {
	let key = getPieceKey(piece)
	if (!size) {
		await until(() => initialized())
		return pieceCache.get(key)!
	}

	return await loadPiece(key as keyof typeof pieceSvgs, size)
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
