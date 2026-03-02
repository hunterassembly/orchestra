import type { SessionDTO, WorkspaceDTO } from '@craft-agent/mobile-contracts';

import { createGatewayServer, type GatewayServer, type GatewaySessionManager } from './index.ts';

export interface MockSessionManager extends GatewaySessionManager {
  getWorkspaces: () => Promise<WorkspaceDTO[]>;
  getSessions: (workspaceId: string) => Promise<SessionDTO[]>;
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

function hasValidBearerToken(authorizationHeader: string | undefined): boolean {
  if (!authorizationHeader) {
    return false;
  }

  const [scheme, token] = authorizationHeader.trim().split(/\s+/, 2);
  if (!scheme || !token) {
    return false;
  }

  return scheme.toLowerCase() === 'bearer';
}

function requireAuth(authorizationHeader: string | undefined): { authorized: true } | { authorized: false } {
  if (!hasValidBearerToken(authorizationHeader)) {
    return { authorized: false };
  }

  return { authorized: true };
}

async function workspaceExists(sessionManager: MockSessionManager, workspaceId: string): Promise<boolean> {
  const workspaces = await sessionManager.getWorkspaces();
  return workspaces.some((workspace) => workspace.id === workspaceId);
}

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
    async getSessions(workspaceId: string) {
      const workspaceFound = seededWorkspaces.some((workspace) => workspace.id === workspaceId);
      if (!workspaceFound) {
        return [];
      }

      return [];
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
        handler: async ({ req, error, json }) => {
          const auth = requireAuth(req.headers.authorization);
          if (!auth.authorized) {
            error(401, 'unauthorized', 'Authorization required');
            return;
          }

          const workspacesResult = await sessionManager.getWorkspaces();
          json(200, workspacesResult);
        },
      },
      {
        method: 'GET',
        path: '/api/workspaces/:workspaceId/sessions',
        handler: async ({ req, params, error, json }) => {
          const auth = requireAuth(req.headers.authorization);
          if (!auth.authorized) {
            error(401, 'unauthorized', 'Authorization required');
            return;
          }

          const workspaceId = params.workspaceId;
          if (!workspaceId || !(await workspaceExists(sessionManager, workspaceId))) {
            error(404, 'workspace_not_found', 'Workspace not found');
            return;
          }

          const sessions = await sessionManager.getSessions(workspaceId);
          json(200, sessions);
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
