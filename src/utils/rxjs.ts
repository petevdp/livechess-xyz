import { Observable } from 'rxjs'
import { addDebugTag } from 'rxjs-traces'

function pipeWithTag<I, O>(o: Observable<I>, tag: string, fn: (inner: Observable<I>) => Observable<O>) {
	let observable = o.pipe(addDebugTag(tag + '__start'))
	const out = fn(observable)
	return out.pipe(addDebugTag(tag + '__end'))
}
