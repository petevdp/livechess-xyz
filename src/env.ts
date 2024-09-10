// src/env.mjs
import { createEnv } from '@t3-oss/env-core'
import { execSync } from 'child_process'
import dotenv from 'dotenv'
import { z } from 'zod'

function exec(cmd: string) {
	return execSync(cmd).toString().trimEnd()
}
export function ensureSetupEnv() {
	if (ENV) return
	_setupEnv()
}

function _setupEnv() {
	if (typeof window !== 'undefined') throw new Error("Don't call this function or load this module on the client")
	dotenv.config()
	const rawEnv = process.env
	const commitDate = exec('git log -1 --format=%cI')
	const branchName = exec('git rev-parse --abbrev-ref HEAD')
	const commitHash = exec('git rev-parse HEAD')
	const lastCommitMessage = exec('git show -s --format=%s')
	process.env.VITE_GIT_COMMIT_DATE = commitDate
	process.env.VITE_GIT_BRANCH_NAME = branchName
	process.env.VITE_GIT_COMMIT_HASH = commitHash
	process.env.VITE_GIT_LAST_COMMIT_MESSAGE = lastCommitMessage
	const env = createEnv({
		clientPrefix: 'VITE_',
		server: {
			HOSTNAME: z.string().ip(),
			EXTERNAL_ORIGIN: z.string().url(),
			PORT: z
				.string()
				.transform((port) => parseInt(port))
				.pipe(z.number().positive()),
			NODE_ENV: z.enum(['development', 'production']),
		},
		client: {
			// we don't actually parse import.meta.env on the client because we don't want to include zod in the client bundle, so don't do any transformations here
			VITE_RUNNING_VITEST: z.enum(['true', 'false']).optional(),
			VITE_GIT_COMMIT_DATE: z.string(),
			VITE_GIT_BRANCH_NAME: z.string(),
			VITE_GIT_COMMIT_HASH: z.string(),
			VITE_GIT_LAST_COMMIT_MESSAGE: z.string(),
		},
		runtimeEnv: rawEnv,
		isServer: true,
	})
	ENV = env
	return env
}

export let ENV: ReturnType<typeof _setupEnv>
export type Env = typeof ENV

export type ClientEnv = typeof ENV & {
	PROD: boolean
	ENVIRONMENT: 'development' | 'production' | 'testing'
}

// set type for import.meta.env
