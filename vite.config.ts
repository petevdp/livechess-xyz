import devtools from 'solid-devtools/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';
import { execSync } from 'child_process'

function exec(cmd: string) {
	return execSync(cmd).toString().trimEnd()
}

export default defineConfig(() => {
	const commitDate = exec('git log -1 --format=%cI')
	const branchName = exec('git rev-parse --abbrev-ref HEAD')
	const commitHash = exec('git rev-parse HEAD')
	const lastCommitMessage = exec('git show -s --format=%s')

	process.env.VITE_GIT_COMMIT_DATE = commitDate
	process.env.VITE_GIT_BRANCH_NAME = branchName
	process.env.VITE_GIT_COMMIT_HASH = commitHash
	process.env.VITE_GIT_LAST_COMMIT_MESSAGE = lastCommitMessage

	const expectedEnvVars = [
		'VITE_GIT_COMMIT_DATE',
		'VITE_GIT_BRANCH_NAME',
		'VITE_GIT_COMMIT_HASH',
		'VITE_GIT_LAST_COMMIT_MESSAGE',
		'VITE_HIGHLIGHT_PROJECT_ID'
	]

	const missingEnvVars = expectedEnvVars.filter((name) => !process.env[name])
	if (missingEnvVars.length) {
		throw new Error(`Missing environment variables: ${missingEnvVars.join(', ')}`)
	}


	return {
		plugins: [devtools({ autoname: true }), solid(), solidSvg(), tsconfigPaths()],
		build: {
			sourcemap: true
		}
	}
})
