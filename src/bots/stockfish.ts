import { until } from '@solid-primitives/promise'
import { Observable, Subscription, endWith, filter, firstValueFrom, share } from 'rxjs'
import { Accessor, createSignal } from 'solid-js'

import * as G from '~/systems/game/game.ts'
import * as GL from '~/systems/game/gameLogic.ts'
import { InProgressMove } from '~/systems/game/gameLogic.ts'
import { type Bot } from '~/systems/vsBot.ts'
import { loadScript } from '~/utils/loadScript.ts'
import { sleep } from '~/utils/time'

// UCI protocol: https://www.wbec-ridderkerk.nl/html/UCIProtocol.html
type UCIFromEngineMsg =
	| {
			type: 'uciok'
	  }
	| {
			type: 'bestmove'
			move: InProgressMove
	  }

export class StockfishBot implements Bot {
	static codeLoaded?: Promise<void>
	static sf: any
	name = 'Stockfish'
	sub?: Subscription
	msg$?: Observable<UCIFromEngineMsg>
	engineReady: Accessor<false>
	setEngineReady: (ready: boolean) => void

	get sf() {
		return StockfishBot.sf
	}

	constructor(
		private difficulty: number,
		private gameConfig: GL.ParsedGameConfig
	) {
		;[this.engineReady, this.setEngineReady] = createSignal(false)
	}

	async setDifficulty(difficulty?: number) {
		if (difficulty !== undefined) this.difficulty = difficulty
		if (!this.engineReady()) return
		if (this.difficulty < 0 || this.difficulty > 20) throw new Error('Invalid difficulty')
		this.postMessage('setoption name Skill Level value ' + difficulty)
		const skill = this.difficulty
		/// Level 0 starts at 1
		const errProb = Math.round(skill * 6.35 + 1)
		/// Level 0 starts at 10
		const maxErr = Math.round(skill * -0.5 + 10)
		this.postMessage(`setoption name Skill Level Maximum Error value ${maxErr}`)
		this.postMessage(`setoption name Skill Level Probability value ${errProb}`)
	}

	get depth() {
		if (this.difficulty < 5) return 1
		if (this.difficulty < 10) return 2
		if (this.difficulty < 15) return 3
		return 10
	}

	// make it seem like bot is actually thinking about the responses
	get artificialMinResponseTime() {
		return 1000
	}

	async initialize() {
		if (!StockfishBot.codeLoaded) {
			if (!wasmThreadsSupported()) {
				// TODO handle gracefully
				throw new Error('WASM threads not supported')
			}
			StockfishBot.codeLoaded = loadScript('/stockfish.js').then(async () => {
				StockfishBot.sf = await window.Stockfish()
			})
		}
		await StockfishBot.codeLoaded
		this.sub?.unsubscribe()
		this.sub = new Subscription()
		this.msg$ = new Observable<UCIFromEngineMsg>((sub) => {
			this.sf.addMessageListener(msgListener)

			function msgListener(message: string) {
				// console.debug('recieved ' + message)
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

		// set difficulty
		this?.setDifficulty()
		if (!msg) throw new Error('UCI setup failed')
		this.setEngineReady(true)
	}

	postMessage(msg: string) {
		// console.debug('sending ' + msg)
		this.sf.postMessage(msg)
	}

	async makeMove(state: GL.GameState, clock?: G.Game['clock']): Promise<GL.InProgressMove> {
		await until(this.engineReady)
		const minResponsePromise = sleep(this.artificialMinResponseTime)
		let serializedMoves = ''
		for (const m of state.moveHistory) {
			serializedMoves += ' ' + toLongForm(m)
		}
		this.postMessage(`position startpos moves${serializedMoves}`)
		let msg = 'go'
		if (this.depth !== null) msg += ` depth ${this.depth}`

		if (clock) {
			const increment = this.gameConfig.increment
			msg += ` wtime ${clock.white} btime ${clock.black} winc ${increment} binc ${increment}`
		}
		this.postMessage(msg)
		const res = await firstValueFrom(
			this.msg$!.pipe(
				filter((msg) => msg.type === 'bestmove'),
				endWith(null)
			)
		)
		await minResponsePromise
		if (!res) throw new Error('No move received')
		return res.move
	}

	dispose() {
		this.sub?.unsubscribe()
	}
}

function toLongForm(move: GL.InProgressMove) {
	let mv = ` ${move.from}${move.to} `
	if (move.disambiguation && move.disambiguation?.type === 'promotion') {
		mv += GL.toShortPieceName(move.disambiguation.piece).toLowerCase()
	}
	return mv
}

function fromLongForm(move: string): GL.InProgressMove {
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
