import { $ } from 'bun'

const detectBranch = async (): Promise<string> => {
	try {
		const branch = (await $`git branch --show-current`.text()).trim()
		return branch || 'unknown'
	} catch {
		return 'unknown'
	}
}

export const BRANCH = process.env['BRANCH'] ?? await detectBranch()
