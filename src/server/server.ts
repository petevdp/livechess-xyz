import fastifyCors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import { Crypto } from '@peculiar/webcrypto'
import Fastify from 'fastify'
import * as fs from 'node:fs'
import path from 'node:path'
import { LoggerOptions } from 'pino'
import QRCode from 'qrcode'
import { Transform } from 'stream'
import { fileURLToPath } from 'url'
import * as ws from 'ws'

import { ENV, Env, ensureSetupEnv } from '../env.ts'
import * as SSN from './systems/sharedStoreNetworks.ts'

ensureSetupEnv()

if (typeof crypto === 'undefined') {
	import('@peculiar/webcrypto').then(() => {
		globalThis.crypto = new Crypto()
	})
}

if (!fs.existsSync('./logs')) {
	fs.mkdirSync('./logs')
}

// improve formatting of logs, have distinct development version
const envToLogger: { [env in Env['NODE_ENV']]: LoggerOptions } = {
	development: {
		level: 'trace',
		// transport: {
		// 	target: 'pino-pretty',
		// 	options: {
		// 		translateTime: 'HH:MM:ss Z',
		// 		ignore: 'pid,hostname',
		// 		color: true,
		// 	},
		// },
	},
	production: {
		transport: {
			targets: [
				// {
				// 	level: 'info',
				// 	target: 'pino-pretty',
				// 	translateTime: 'HH:MM:ss Z',
				// 	ignore: 'pid,hostname',
				// },
				{
					level: 'trace',
					target: 'pino/file',
					options: {
						translateTime: 'HH:MM:ss Z',
						ignore: 'pid,hostname',
						destination: './logs/server.log',
					},
				},
			],
		},
	},
}

const server = Fastify({ logger: envToLogger[ENV.NODE_ENV] })
server.log.child({ env: ENV }).info(`environment: %s`, ENV.NODE_ENV, ENV)
server.register(fastifyWebsocket)
server.register(fastifyCors, () => {
	return (req: any, callback: any) => {
		const corsOptions = {
			// This is NOT recommended for production as it enables reflection exploits
			origin: true,
		}

		// do not include CORS headers for requests from localhost
		if (/^localhost$/m.test(req.headers.origin)) {
			corsOptions.origin = false
		}

		// callback expects two parameters: error and options
		callback(null, corsOptions)
	}
})
const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dist')
server.register(fastifyStatic, {
	root: PROJECT_ROOT,
	setHeaders: (res) => {
		res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
		res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
	},
})

//#region websocket routes
server.register(async function () {
	server.get('/api/networks/:networkId', { websocket: true }, (connection, request) => {
		//@ts-expect-error
		const networkId: string = request.params!.networkId
		const log = request.log.child({ networkId })

		SSN.handleNewConnection(connection.socket as unknown as ws.WebSocket, networkId, log)
	})
})
//#endregion

// for keep-alive on render server
server.get('/api/ping', () => {
	return 'pong\n'
})

server.post('/api/networks', (req) => {
	return SSN.createNetwork(req.log)
})

server.head('/api/networks/:networkId', (req, res) => {
	//@ts-expect-error
	const networkId: string = req.params.networkId
	if (SSN.getNetwork(networkId)) {
		res.status(200).send()
	} else {
		res.status(404).send()
	}
})

function getHtmlResponse(_: unknown, res: any) {
	return res
		.sendFile('index.html')
		.header('Cross-Origin-Opener-Policy', 'same-origin')
		.header('Cross-Origin-Embedder-Policy', 'require-corp')
}

server.get('/rooms/:networkId', getHtmlResponse)
server.get('/bot', getHtmlResponse)

server.get('/api/qrcodes/:filename', async (req, res) => {
	//@ts-expect-error
	const filename: string = req.params.filename
	if (!filename.endsWith('.png')) {
		return res.status(404).send('file not found')
	}
	const network = SSN.getNetwork(filename.split('.')[0])
	if (!network) {
		return res.status(404).send('network not found')
	}

	const inoutStream = new Transform({
		transform(chunk, _, callback) {
			this.push(chunk)
			callback()
		},
	})
	void QRCode.toFileStream(inoutStream, `${ENV.EXTERNAL_ORIGIN}/rooms/${network.id}`, { scale: 12 })
	return res.type('image/png').header('Cache-Control', 'public, max-age=31536000, immutable').send(inoutStream)
})

//

SSN.setupSharedStoreSystem(server.log)

server.listen({ port: ENV.PORT, host: ENV.HOSTNAME }, (err) => {
	if (err) {
		server.log.error(err)
		process.exit(1)
	}
})
