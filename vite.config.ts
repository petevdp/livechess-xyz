import { execSync } from 'child_process'
import devtools from 'solid-devtools/vite'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import solidSvg from 'vite-plugin-solid-svg'
import tsconfigPaths from 'vite-tsconfig-paths'
import dotenv from 'dotenv'
dotenv.config()

function exec(cmd: string) {
	return execSync(cmd).toString().trimEnd()
}

// noinspection JSUnusedGlobalSymbols
export default defineConfig(() => {
	const commitDate = exec('git log -1 --format=%cI')
	const branchName = exec('git rev-parse --abbrev-ref HEAD')
	const commitHash = exec('git rev-parse HEAD')
	const lastCommitMessage = exec('git show -s --format=%s')

	process.env.VITE_GIT_COMMIT_DATE = commitDate
	process.env.VITE_GIT_BRANCH_NAME = branchName
	process.env.VITE_GIT_COMMIT_HASH = commitHash
	process.env.VITE_GIT_LAST_COMMIT_MESSAGE = lastCommitMessage

	let httpTarget = 'http://' + process.env.HOSTNAME + ':' + process.env.PORT;
	const wsTarget = 'ws://' + process.env.HOSTNAME + ':' + process.env.PORT;
	console.log('target:', httpTarget);
	return {
		plugins: [devtools({ autoname: true }), solid(), solidSvg(), tsconfigPaths()],
		build: {
			sourcemap: true
		},
		server: {
			proxy: {
				"/api": {
					target: httpTarget,
					changeOrigin: true
				},
				"^/api/networks/.*": {
					target: wsTarget,
					changeOrigin: true,
					ws: true
				},
			}
		}
	}
})
