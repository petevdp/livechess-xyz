import pinoPkg from 'pino'

export const log = pinoPkg({
	browser: {
		// asObject: false,
		write: {
			info(o) {
				console.log(o)
			},
			debug(o) {
				console.debug(o)
			},
			trace(o) {
				console.debug(o)
			},
			error(o) {
				console.error(o)
			},
			warn(o) {
				console.warn(o)
			},
		},
	},
})
