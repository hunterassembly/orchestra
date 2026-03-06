import { createRequire } from 'module'
import { dirname, join } from 'path'
import { pathToFileURL } from 'url'
import type { OAuthCredentials } from '@mariozechner/pi-ai'

type GitHubCopilotLoginArgs = {
  onAuth: (url: string, instructions?: string) => void
  onPrompt: (prompt: { message: string; placeholder?: string; allowEmpty?: boolean }) => Promise<string>
  onProgress?: (message: string) => void
  signal?: AbortSignal
}

type PiOAuthModule = {
  loginGitHubCopilot: (args: GitHubCopilotLoginArgs) => Promise<OAuthCredentials>
  refreshGitHubCopilotToken: (refreshToken: string, enterpriseDomain?: string) => Promise<OAuthCredentials>
}

const require = createRequire(
  typeof __filename !== 'undefined'
    ? __filename
    : join(process.cwd(), 'pi-oauth-runtime.mjs'),
)

async function loadPiOAuthModule(): Promise<PiOAuthModule> {
  const piEntryPath = require.resolve('@mariozechner/pi-ai')
  const oauthModulePath = join(dirname(piEntryPath), 'utils', 'oauth', 'index.js')
  return import(pathToFileURL(oauthModulePath).href) as Promise<PiOAuthModule>
}

export async function loginGitHubCopilotWithPi(args: GitHubCopilotLoginArgs): Promise<OAuthCredentials> {
  const module = await loadPiOAuthModule()
  return module.loginGitHubCopilot(args)
}

export async function refreshGitHubCopilotTokenWithPi(refreshToken: string, enterpriseDomain?: string): Promise<OAuthCredentials> {
  const module = await loadPiOAuthModule()
  return module.refreshGitHubCopilotToken(refreshToken, enterpriseDomain)
}
