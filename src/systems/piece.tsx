import { until } from '@solid-primitives/promise'
import { createEffect, createMemo, createSignal } from 'solid-js'

import bdt45 from '~/assets/pieces/bdt45.svg'
import blt45 from '~/assets/pieces/blt45.svg'
import duck from '~/assets/pieces/duck.svg'
import kdt45 from '~/assets/pieces/kdt45.svg'
import klt45 from '~/assets/pieces/klt45.svg'
import ndt45 from '~/assets/pieces/ndt45.svg'
import nlt45 from '~/assets/pieces/nlt45.svg'
import pdt45 from '~/assets/pieces/pdt45.svg'
import plt45 from '~/assets/pieces/plt45.svg'
import qdt45 from '~/assets/pieces/qdt45.svg'
import qlt45 from '~/assets/pieces/qlt45.svg'
import rdt45 from '~/assets/pieces/rdt45.svg'
import rlt45 from '~/assets/pieces/rlt45.svg'

import * as GL from './game/gameLogic.ts'

const pieces = {
	bdt45,
	blt45,
	duck,
	kdt45,
	klt45,
	ndt45,
	nlt45,
	pdt45,
	plt45,
	qdt45,
	qlt45,
	rdt45,
	rlt45,
}

export const pieceCache = new Map<string, HTMLImageElement>()

export const [squareSize, setSquareSize] = createSignal(32)
export const [initialized, setInitialized] = createSignal(false)

function loadPiece(key: keyof typeof pieces, squareSize: number) {
	const Svg = pieces[key]
	//@ts-ignore
	const svg = (<Svg width={squareSize} height={squareSize} />) as HTMLElement
	const xml = new XMLSerializer().serializeToString(svg)
	const image64 = 'data:image/svg+xml;base64,' + btoa(xml)
	return loadImage(image64, squareSize)
}

export function initPieceSystem() {
	// round to nearest power of 2
	const roundedSquareSize = createMemo(() => {
		const scale = squareSize() / 45
		const roundedScale = Math.pow(2, Math.round(Math.log2(scale)))
		return roundedScale * 45
	})
	createEffect(() => {
		console.log('loading piece sizes: ', roundedSquareSize())
		let promises: Promise<void>[] = []
		for (const key in pieces) {
			promises.push(
				loadPiece(key as keyof typeof pieces, roundedSquareSize()).then((img) => {
					pieceCache.set(key, img)
				})
			)
		}

		if (initialized()) return
		Promise.all(promises).then(() => {
			setInitialized(true)
		})
	})
}

function getPieceKey(piece: GL.ColoredPiece) {
	const abbrs = {
		pawn: 'p',
		knight: 'n',
		bishop: 'b',
		rook: 'r',
		queen: 'q',
		king: 'k',
	}
	const color = piece.color == 'white' ? 'l' : 'd'
	if (piece.type === 'duck') return '/pieces/duck.svg'
	else return `${abbrs[piece.type]}${color}t45`
}

export function getPieceSrc(piece: GL.ColoredPiece) {
	return `/pieces/${getPieceKey(piece)}.svg`
}

export async function getPiece(piece: GL.ColoredPiece, size?: number) {
	let key = getPieceKey(piece)
	if (!size) {
		await until(() => initialized())
		return pieceCache.get(key)!
	}

	return await loadPiece(key as keyof typeof pieces, size)
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
