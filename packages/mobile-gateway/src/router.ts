export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | 'HEAD';

export interface RouteMatchResult<THandler> {
  type: 'match';
  handler: THandler;
  params: Record<string, string>;
}

export interface RouteNotFoundResult {
  type: 'not_found';
}

export interface RouteMethodNotAllowedResult {
  type: 'method_not_allowed';
  allowedMethods: string[];
}

export type RouterMatchResult<THandler> =
  | RouteMatchResult<THandler>
  | RouteNotFoundResult
  | RouteMethodNotAllowedResult;

export interface RouteDefinition<THandler> {
  method: HttpMethod;
  path: string;
  handler: THandler;
}

interface CompiledRoute<THandler> {
  method: string;
  path: string;
  segments: string[];
  handler: THandler;
}

export interface Router<THandler> {
  addRoute(route: RouteDefinition<THandler>): void;
  match(method: string, path: string): RouterMatchResult<THandler>;
}

function normalizePath(path: string): string {
  if (!path) {
    return '/';
  }

  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;

  if (withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')) {
    return withLeadingSlash.slice(0, -1);
  }

  return withLeadingSlash;
}

function toSegments(path: string): string[] {
  const normalizedPath = normalizePath(path);
  if (normalizedPath === '/') {
    return [];
  }

  return normalizedPath.split('/').filter(Boolean);
}

function matchPath(patternSegments: string[], actualSegments: string[]): Record<string, string> | null {
  if (patternSegments.length !== actualSegments.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index];
    const actualSegment = actualSegments[index];

    if (!patternSegment || !actualSegment) {
      return null;
    }

    if (patternSegment.startsWith(':')) {
      const key = patternSegment.slice(1);
      params[key] = decodeURIComponent(actualSegment);
      continue;
    }

    if (patternSegment !== actualSegment) {
      return null;
    }
  }

  return params;
}

export function createRouter<THandler>(routes: RouteDefinition<THandler>[] = []): Router<THandler> {
  const compiledRoutes: CompiledRoute<THandler>[] = [];

  const addRoute = (route: RouteDefinition<THandler>): void => {
    compiledRoutes.push({
      method: route.method.toUpperCase(),
      path: normalizePath(route.path),
      segments: toSegments(route.path),
      handler: route.handler,
    });
  };

  for (const route of routes) {
    addRoute(route);
  }

  const match = (method: string, path: string): RouterMatchResult<THandler> => {
    const normalizedPath = normalizePath(path);
    const normalizedMethod = method.toUpperCase();
    const segments = toSegments(normalizedPath);

    const allowedMethods = new Set<string>();

    for (const route of compiledRoutes) {
      const params = matchPath(route.segments, segments);
      if (!params) {
        continue;
      }

      if (route.method === normalizedMethod) {
        return {
          type: 'match',
          handler: route.handler,
          params,
        };
      }

      allowedMethods.add(route.method);
    }

    if (allowedMethods.size > 0) {
      return {
        type: 'method_not_allowed',
        allowedMethods: Array.from(allowedMethods).sort(),
      };
    }

    return { type: 'not_found' };
  };

  return {
    addRoute,
    match,
  };
}
