import { Observable, concatMap, endWith, firstValueFrom, share } from 'rxjs'

import { WS_API_URL } from '../config.ts'
import { BaseEvent, ClientTaggedEvent, type SharedStoreMessage, type Transport } from './sharedStore.ts'

export class WsTransport<Event extends BaseEvent, Msg extends SharedStoreMessage<ClientTaggedEvent<Event>>> implements Transport<Msg> {
	ws: WebSocket
	message$: Observable<Msg>
	disposed$: Promise<void>

	constructor(public networkId: string) {
		const url = `${WS_API_URL}/networks/` + networkId
		// TODO retry on disconnect?
		this.ws = new WebSocket(url)
		this.message$ = new Observable<Msg>((subscriber) => {
			const listener = (event: MessageEvent) => {
				const message = JSON.parse(event.data) as Msg
				subscriber.next(message)
			}

			this.ws.addEventListener('close', () => {
				subscriber.complete()
			})

			this.ws.addEventListener('message', listener)
			return () => {
				this.ws.removeEventListener('message', listener)
			}
		}).pipe(share())

		this.disposed$ = firstValueFrom(
			this.message$.pipe(
				concatMap(() => [] as undefined[]),
				endWith(undefined)
			)
		) as Promise<void>

		if (typeof window !== 'undefined') {
			window.addEventListener('beforeunload', () => {
				this.ws.close()
			})
		}
	}

	send(msg: Msg) {
		this.ws.send(JSON.stringify(msg))
	}

	dispose() {
		this.ws.close()
	}

	waitForConnected() {
		return new Promise<void>((resolve) => {
			if (this.ws.readyState === WebSocket.OPEN) {
				resolve()
				return
			}
			const listener = () => {
				this.ws.removeEventListener('open', listener)
				resolve()
			}
			this.ws.addEventListener('open', listener)
		})
	}
}
