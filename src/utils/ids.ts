// get a url safe random id with 64 bits of entropy per character
if (typeof crypto === 'undefined') {
	const {Crypto} = await import('@peculiar/webcrypto')
	globalThis.crypto = new Crypto()
}

export function createId(size: number) {
	let result = ''
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-' // length 64
	const arr = new Uint8Array(size)
	crypto.getRandomValues(arr)

	for (let i = 0; i < arr.length; i++) {
		// we're wasting entropy here but it's not a big deal
		result += characters[arr[i] % 64]
	}

	return result
}
