type Resolve<T> = (value: T | PromiseLike<T>) => void
type Reject = (reason?: any) => void

/**
 * A Promise that can be resolved or rejected externally
 */
export class Future<T> implements Promise<T> {
	public resolve: Resolve<T>
	public reject: Reject

	// fulfilled does not necessarily mean that we've resolved the inner promise, it just means that this.resolve has been called
	public fulfilled: boolean = false
	public then: Promise<T>['then']
	public catch: Promise<T>['catch']
	public finally: Promise<T>['finally']
	public value: null | T = null
	private promise: Promise<T>

	constructor() {
		let _resolve: Resolve<T>
		let _reject: Reject

		this.promise = new Promise((resolve, reject) => {
			_resolve = resolve
			_reject = reject
		})

		this.resolve = (value) => {
			if (this.fulfilled) throw new AlreadyFulfilledError()
			this.fulfilled = true
			if (value instanceof Promise) {
				value.then((v) => {
					this.resolve(v)
					this.value = v
				})
			} else {
				//@ts-expect-error
				this.value = value
				_resolve(value)
			}
		}

		this.reject = (value: any) => {
			if (this.fulfilled) throw new AlreadyFulfilledError()
			_reject(value)
		}

		this.then = ((...args: any[]) => this.promise.then(...args)) as typeof this.promise.then
		this.catch = ((...args: any[]) => this.promise.catch(...args)) as typeof this.promise.catch
		this.finally = ((...args: any[]) => this.promise.finally(...args)) as typeof this.promise.finally
	}

	get [Symbol.toStringTag]() {
		return 'FUUUUUUTTTUUUURREEE'
	}
}

export class AlreadyFulfilledError extends Error {
	constructor() {
		super('Future has already been fulfilled!')
	}
}
