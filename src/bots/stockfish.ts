import { until } from '@solid-primitives/promise'
import { Observable, Subscription, endWith, filter, firstValueFrom, share } from 'rxjs'
import { Accessor, createSignal } from 'solid-js'

import * as GL from '~/systems/game/gameLogic.ts'
import { SelectedMove } from '~/systems/game/gameLogic.ts'
import { type Bot } from '~/systems/vsBot.ts'
import { loadScript } from '~/utils/loadScript.ts'

type UCIFromEngineMsg =
	| {
			type: 'uciok'
	  }
	| {
			type: 'bestmove'
			move: SelectedMove
	  }

export class StockfishBot implements Bot {
	static codeLoaded?: Promise<void>
	name = 'Stockfish'
	sf: any
	sub = new Subscription()
	msg$: Observable<UCIFromEngineMsg>
	engineReady: Accessor<false>
	setEngineReady: (ready: boolean) => void

	constructor() {
		;[this.engineReady, this.setEngineReady] = createSignal(false)
	}

	setDifficulty(difficulty: number) {}

	async initialize() {
		if (!StockfishBot.codeLoaded) {
			StockfishBot.codeLoaded = loadScript('/stockfish.js')
		}
		await StockfishBot.codeLoaded
		if (!wasmThreadsSupported()) {
			// TODO handle gracefully
			throw new Error('WASM threads not supported')
		}
		this.sf = await window.Stockfish()
		this.msg$ = new Observable<UCIFromEngineMsg>((sub) => {
			this.sf.addMessageListener(msgListener)

			function msgListener(message: string) {
				console.debug('recieved ' + message)
				if (message === 'uciok') {
					sub.next({ type: 'uciok' })
					return
				}
				if (message.startsWith('bestmove')) {
					const [_, move] = message.split(' ')
					sub.next({ type: 'bestmove', move: fromLongForm(move) })
				}
			}

			return () => {
				this.sf.removeMessageListener(msgListener)
			}
		}).pipe(share())

		this.sub.add(this.msg$.subscribe())
		const msgPromise = firstValueFrom(
			this.msg$.pipe(
				filter((msg) => msg.type === 'uciok'),
				endWith(null)
			)
		)
		this.postMessage('uci')
		const msg = await msgPromise
		if (!msg) throw new Error('UCI setup failed')
		this.setEngineReady(true)
	}

	postMessage(msg: string) {
		console.debug('sending ' + msg)
		this.sf.postMessage(msg)
	}

	async makeMove(state: GL.GameState): Promise<GL.SelectedMove> {
		await until(this.engineReady)
		let serializedMoves = ''
		for (const m of state.moveHistory) {
			serializedMoves += ' ' + toLongForm(m)
		}
		this.postMessage(`position startpos moves${serializedMoves}`)
		this.postMessage('go depth 20')
		const res = await firstValueFrom(
			this.msg$.pipe(
				filter((msg) => msg.type === 'bestmove'),
				endWith(null)
			)
		)
		if (!res) throw new Error('No move received')
		return res.move
	}

	dispose() {
		this.sub.unsubscribe()
	}
}

function toLongForm(move: GL.SelectedMove) {
	let mv = ` ${move.from}${move.to} `
	if (move.disambiguation && move.disambiguation?.type === 'promotion') {
		mv += GL.toShortPieceName(move.disambiguation.piece).toLowerCase()
	}
	return mv
}

function fromLongForm(move: string): GL.SelectedMove {
	const from = move.slice(0, 2)
	const to = move.slice(2, 4)
	const promotion = move.slice(4) ?? null
	const disambiguation: GL.MoveDisambiguation | undefined = promotion
		? { type: 'promotion', piece: GL.toLongPieceName(promotion.toUpperCase()) as GL.PromotionPiece }
		: undefined
	return { from, to, disambiguation }
}

function wasmThreadsSupported() {
	// WebAssembly 1.0
	const source = Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00)
	if (typeof WebAssembly !== 'object' || typeof WebAssembly.validate !== 'function') return false
	if (!WebAssembly.validate(source)) return false

	// SharedArrayBuffer
	if (typeof SharedArrayBuffer !== 'function') return false

	// Atomics
	if (typeof Atomics !== 'object') return false

	// Shared memory
	const mem = new WebAssembly.Memory({ shared: true, initial: 8, maximum: 16 })
	if (!(mem.buffer instanceof SharedArrayBuffer)) return false

	// Structured cloning
	try {
		// You have to make sure nobody cares about these messages!
		window.postMessage(mem, '*')
	} catch (e) {
		return false
	}

	// Growable shared memory (optional)
	try {
		mem.grow(8)
	} catch (e) {
		return false
	}

	return true
}
