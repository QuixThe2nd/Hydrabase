import { $ } from 'bun'

const detectBranch = async (): Promise<string> => {
	try {
		const branch = (await $`git branch --show-current`.text()).trim()
		return branch || 'unknown'
	} catch {
		return 'unknown'
	}
}

const detectGitHash = async (): Promise<string> => {
	const envHash = process.env['GIT_HASH'] ?? process.env['COMMIT_HASH'] ?? process.env['GITHUB_SHA']
	if (envHash) {
		const normalizedEnvHash = envHash.trim().slice(0, 12)
		if (normalizedEnvHash) return normalizedEnvHash
	}

	try {
		const hash = (await $`git rev-parse --short=12 HEAD`.text()).trim()
		return hash || 'unknown'
	} catch {
		return 'unknown'
	}
}

export const BRANCH = process.env['BRANCH'] ?? await detectBranch()
export const GIT_HASH = await detectGitHash()
