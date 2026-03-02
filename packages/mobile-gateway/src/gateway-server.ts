import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { SessionEventDTO, WorkspaceDTO } from '@craft-agent/mobile-contracts';

import { parseJsonBody, parseQuery, RequestParsingError, type ParsedQuery } from './request-parsing.ts';
import { createRouter, type HttpMethod, type RouteDefinition } from './router.ts';
import { error as writeError, json as writeJson, noContent as writeNoContent } from './response-helpers.ts';

type GatewayLoggerLevel = 'info' | 'warn' | 'error';

export interface GatewaySessionManager {
  getWorkspaces?: () => Promise<WorkspaceDTO[]>;
  [key: string]: unknown;
}

export interface GatewayRouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: HttpMethod;
  path: string;
  url: URL;
  params: Record<string, string>;
  query: ParsedQuery;
  sessionManager: GatewaySessionManager;
  parseJsonBody: <T>() => Promise<T>;
  json: (status: number, payload: unknown) => void;
  error: (status: number, code: string, message: string) => void;
  noContent: (status?: number) => void;
}

export type GatewayRouteHandler = (context: GatewayRouteContext) => void | Promise<void>;

export type GatewayRoute = RouteDefinition<GatewayRouteHandler>;

export interface GatewayServerConfig {
  host?: string;
  port: number;
  sessionManager: GatewaySessionManager;
  routes?: GatewayRoute[];
  logger?: (level: GatewayLoggerLevel, message: string, details?: Record<string, unknown>) => void;
}

export interface GatewayServerStartResult {
  host: string;
  port: number;
}

export type GatewayBroadcastListener = (event: SessionEventDTO) => void;

export interface GatewayServer {
  start: () => Promise<GatewayServerStartResult>;
  stop: () => Promise<void>;
  broadcast: (event: SessionEventDTO) => void;
  onBroadcast: (listener: GatewayBroadcastListener) => () => void;
}

const DEFAULT_HOST = '127.0.0.1';

export function createGatewayServer(config: GatewayServerConfig): GatewayServer {
  const host = config.host ?? DEFAULT_HOST;
  const router = createRouter(config.routes ?? []);
  const listeners = new Set<GatewayBroadcastListener>();

  let server: Server | null = null;
  let boundPort = 0;

  const log = (level: GatewayLoggerLevel, message: string, details?: Record<string, unknown>): void => {
    config.logger?.(level, message, details);
  };

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const requestMethod = ((req.method ?? 'GET').toUpperCase() as HttpMethod);
    const requestUrl = new URL(req.url ?? '/', `http://${host}`);

    const routeMatch = router.match(requestMethod, requestUrl.pathname);

    if (routeMatch.type === 'not_found') {
      writeError(res, 404, 'not_found', 'Route not found');
      return;
    }

    if (routeMatch.type === 'method_not_allowed') {
      res.setHeader('allow', routeMatch.allowedMethods.join(', '));
      writeError(res, 405, 'method_not_allowed', 'Method not allowed');
      return;
    }

    const context: GatewayRouteContext = {
      req,
      res,
      method: requestMethod,
      path: requestUrl.pathname,
      url: requestUrl,
      params: routeMatch.params,
      query: parseQuery(requestUrl.searchParams),
      sessionManager: config.sessionManager,
      parseJsonBody: <T>() => parseJsonBody<T>(req),
      json: (status, payload) => writeJson(res, status, payload),
      error: (status, code, message) => writeError(res, status, code, message),
      noContent: (status) => writeNoContent(res, status),
    };

    try {
      await routeMatch.handler(context);

      if (!res.writableEnded) {
        writeNoContent(res);
      }
    } catch (error) {
      if (res.writableEnded) {
        return;
      }

      if (error instanceof RequestParsingError) {
        writeError(res, error.status, error.code, error.message);
        return;
      }

      log('error', 'Unhandled gateway route error', {
        path: requestUrl.pathname,
        method: requestMethod,
        error: error instanceof Error ? error.message : String(error),
      });
      writeError(res, 500, 'internal_error', 'Internal server error');
    }
  };

  const start = async (): Promise<GatewayServerStartResult> => {
    if (server) {
      return {
        host,
        port: boundPort,
      };
    }

    const httpServer = createServer((req, res) => {
      void handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        httpServer.off('listening', onListening);
        reject(error);
      };

      const onListening = (): void => {
        httpServer.off('error', onError);
        resolve();
      };

      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      httpServer.listen(config.port, host);
    });

    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Gateway server failed to bind to a TCP port');
    }

    server = httpServer;
    boundPort = address.port;

    log('info', 'Gateway server started', {
      host,
      port: boundPort,
    });

    return {
      host,
      port: boundPort,
    };
  };

  const stop = async (): Promise<void> => {
    if (!server) {
      return;
    }

    const runningServer = server;

    await new Promise<void>((resolve, reject) => {
      runningServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    server = null;
    boundPort = 0;
    log('info', 'Gateway server stopped');
  };

  const broadcast = (event: SessionEventDTO): void => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        log('warn', 'Gateway broadcast listener failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  const onBroadcast = (listener: GatewayBroadcastListener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    start,
    stop,
    broadcast,
    onBroadcast,
  };
}
