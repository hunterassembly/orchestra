import { join } from 'node:path';
import type { ProviderDriver } from '../driver-types.ts';
import { getPiModelsForAuthProvider } from '../../../../config/models-pi.ts';
import { setVendorRoot } from '../../../../codex/binary-resolver.ts';
import { getSessionPath } from '../../../../sessions/storage.ts';

const CODEX_PI_AUTH_PROVIDER = 'openai-codex';

export const codexDriver: ProviderDriver = {
  provider: 'codex',
  initializeHostRuntime: ({ hostRuntime }) => {
    setVendorRoot(hostRuntime.appRootPath);
  },
  prepareRuntime: ({ hostRuntime }) => {
    setVendorRoot(hostRuntime.appRootPath);
  },
  buildRuntime: ({ coreConfig, resolvedPaths }) => {
    const sessionPath = coreConfig.workspace.rootPath && coreConfig.session?.id
      ? getSessionPath(coreConfig.workspace.rootPath, coreConfig.session.id)
      : undefined;

    return {
      paths: {
        sessionServer: resolvedPaths.sessionServerPath,
        bridgeServer: resolvedPaths.bridgeServerPath,
        node: resolvedPaths.nodeRuntimePath,
      },
      codexHome: sessionPath ? join(sessionPath, '.codex-home') : undefined,
      piAuthProvider: CODEX_PI_AUTH_PROVIDER,
    };
  },
  fetchModels: async () => {
    const models = getPiModelsForAuthProvider(CODEX_PI_AUTH_PROVIDER);
    if (models.length === 0) {
      throw new Error('No Codex models found for openai-codex provider.');
    }
    return { models };
  },
  validateStoredConnection: async () => ({ success: true }),
};
