import type { WorkspaceDTO } from '@craft-agent/mobile-contracts';

import { createGatewayServer, type GatewayServer, type GatewaySessionManager } from './index.ts';

export interface MockSessionManager extends GatewaySessionManager {
  getWorkspaces: () => Promise<WorkspaceDTO[]>;
}

export interface TestServerOptions {
  host?: string;
  port?: number;
  version?: string;
  sessionManager?: MockSessionManager;
}

const DEFAULT_PORT = 7842;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_VERSION = '0.0.0';

export function createMockSessionManager(workspaces?: WorkspaceDTO[]): MockSessionManager {
  const seededWorkspaces = workspaces ?? [
    {
      id: 'default',
      name: 'Default Workspace',
    },
  ];

  return {
    async getWorkspaces() {
      return [...seededWorkspaces];
    },
  };
}

export function createTestServer(options: TestServerOptions = {}): GatewayServer {
  const sessionManager = options.sessionManager ?? createMockSessionManager();
  const version = options.version ?? DEFAULT_VERSION;

  return createGatewayServer({
    host: options.host ?? DEFAULT_HOST,
    port: options.port ?? DEFAULT_PORT,
    sessionManager,
    routes: [
      {
        method: 'GET',
        path: '/api/health',
        handler: ({ json }) => {
          json(200, {
            status: 'ok',
            version,
          });
        },
      },
      {
        method: 'GET',
        path: '/api/workspaces',
        handler: async ({ json }) => {
          const workspacesResult = await sessionManager.getWorkspaces();
          json(200, workspacesResult);
        },
      },
    ],
  });
}

if (import.meta.main) {
  const configuredPort = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const server = createTestServer({
    port: Number.isNaN(configuredPort) ? DEFAULT_PORT : configuredPort,
  });

  const shutdown = async (): Promise<void> => {
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });

  process.on('SIGTERM', () => {
    void shutdown();
  });

  const { host, port } = await server.start();
  // eslint-disable-next-line no-console
  console.log(`[mobile-gateway:test-server] listening on http://${host}:${port}`);
}
