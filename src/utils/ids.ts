import * as UrlSafeb64 from 'url-safe-base64'

export async function bufferToBase64(buffer: Uint8Array) {
	// use a FileReader to generate a base64 data URI:
	const base64url = await new Promise<string>((r) => {
		const reader = new FileReader()
		reader.onload = () => r(reader.result as string)
		reader.readAsDataURL(new Blob([buffer]))
	})
	// remove the `data:...;base64,` part from the start
	return base64url.slice(base64url.indexOf(',') + 1)
}

// get url safe random id
export async function createId(size: number) {
	const entropy = new Uint8Array(size)
	crypto.getRandomValues(entropy)
	const entropyStr = await bufferToBase64(entropy)

	return UrlSafeb64.encode(entropyStr)
}

export function createIdSync(size: number) {
	let result = ''
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
	const charactersLength = characters.length
	let counter = 0
	while (counter < size) {
		// TODO use crypto.randomBytes instead
		result += characters.charAt(Math.floor(Math.random() * charactersLength))
		counter += 1
	}
	return result
}
