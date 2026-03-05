import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { BackendHostRuntimeContext } from '../types.ts';
import {
  setExecutable,
  setInterceptorPath,
  setPathToClaudeCodeExecutable,
} from '../../options.ts';

export interface ResolvedBackendRuntimePaths {
  claudeCliPath?: string;
  claudeInterceptorPath?: string;
  interceptorBundlePath?: string;
  copilotCliPath?: string;
  sessionServerPath?: string;
  bridgeServerPath?: string;
  piServerPath?: string;
  nodeRuntimePath?: string;
  bundledRuntimePath?: string;
}

export interface ResolvedBackendHostTooling {
  ripgrepPath?: string;
}

function firstExistingPath(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Walk up from `base` checking `join(ancestor, relativePath)` at each level.
 * Stops after `maxLevels` ancestors or when hitting the filesystem root.
 */
function resolveUpwards(base: string, relativePath: string, maxLevels = 4): string | undefined {
  let dir = resolve(base);
  for (let i = 0; i <= maxLevels; i++) {
    const candidate = join(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return undefined;
}

function resolveBundledRuntimePath(hostRuntime: BackendHostRuntimeContext): string | undefined {
  const bunBinary = process.platform === 'win32' ? 'bun.exe' : 'bun';
  const bunBasePath = process.platform === 'win32'
    ? (hostRuntime.resourcesPath || hostRuntime.appRootPath)
    : hostRuntime.appRootPath;
  const bunPath = join(bunBasePath, 'vendor', 'bun', bunBinary);
  return existsSync(bunPath) ? bunPath : undefined;
}

function resolveClaudeCliPath(hostRuntime: BackendHostRuntimeContext): string | undefined {
  const sdkRelative = join('node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js');
  return firstExistingPath([
    join(hostRuntime.appRootPath, sdkRelative),
    // Packaged apps may place extraResources under process.resourcesPath/app/**.
    ...(hostRuntime.resourcesPath
      ? [
          join(hostRuntime.resourcesPath, 'app', sdkRelative),
          join(hostRuntime.resourcesPath, sdkRelative),
          // Some packaging layouts place resources under app/dist.
          join(hostRuntime.resourcesPath, 'app', 'dist', sdkRelative),
        ]
      : []),
    // Dev/runtime cwd can vary (repo root, apps/electron, dist, etc.) across launch paths.
    ...(() => {
      const resolved: string[] = [];
      const fromAppRoot = resolveUpwards(hostRuntime.appRootPath, sdkRelative, 10);
      if (fromAppRoot) resolved.push(fromAppRoot);
      const fromCwd = resolveUpwards(process.cwd(), sdkRelative, 10);
      if (fromCwd) resolved.push(fromCwd);
      return resolved;
    })(),
  ]);
}

function resolveClaudeInterceptorPath(hostRuntime: BackendHostRuntimeContext): string | undefined {
  const interceptorSourceRelative = join('packages', 'shared', 'src', 'unified-network-interceptor.ts');
  const interceptorBundleRelative = join('dist', 'interceptor.cjs');
  return firstExistingPath([
    // Source form (dev / unpacked app with sources included)
    join(hostRuntime.appRootPath, interceptorSourceRelative),
    // Bundled form (preferred for packaged apps)
    join(hostRuntime.appRootPath, interceptorBundleRelative),
    ...(hostRuntime.resourcesPath
      ? [
          join(hostRuntime.resourcesPath, 'app', interceptorSourceRelative),
          join(hostRuntime.resourcesPath, interceptorSourceRelative),
          join(hostRuntime.resourcesPath, 'app', interceptorBundleRelative),
          join(hostRuntime.resourcesPath, interceptorBundleRelative),
        ]
      : []),
    ...(() => {
      const resolved: string[] = [];
      const fromAppRootSource = resolveUpwards(hostRuntime.appRootPath, interceptorSourceRelative, 10);
      if (fromAppRootSource) resolved.push(fromAppRootSource);
      const fromAppRootBundle = resolveUpwards(hostRuntime.appRootPath, interceptorBundleRelative, 10);
      if (fromAppRootBundle) resolved.push(fromAppRootBundle);
      const fromCwdSource = resolveUpwards(process.cwd(), interceptorSourceRelative, 10);
      if (fromCwdSource) resolved.push(fromCwdSource);
      const fromCwdBundle = resolveUpwards(process.cwd(), interceptorBundleRelative, 10);
      if (fromCwdBundle) resolved.push(fromCwdBundle);
      return resolved;
    })(),
  ]);
}

function resolveInterceptorBundlePath(hostRuntime: BackendHostRuntimeContext): string | undefined {
  if (hostRuntime.interceptorBundlePath && existsSync(hostRuntime.interceptorBundlePath)) {
    return hostRuntime.interceptorBundlePath;
  }

  return resolveUpwards(hostRuntime.appRootPath, join('dist', 'interceptor.cjs'))
    ?? resolveUpwards(hostRuntime.appRootPath, join('apps', 'electron', 'dist', 'interceptor.cjs'));
}

function resolveCopilotCliPath(hostRuntime: BackendHostRuntimeContext): string | undefined {
  const platform = process.platform === 'win32'
    ? 'win32'
    : process.platform === 'linux'
      ? 'linux'
      : 'darwin';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const binaryName = platform === 'win32' ? 'copilot.exe' : 'copilot';

  if (hostRuntime.isPackaged) {
    const packaged = join(hostRuntime.appRootPath, 'vendor', 'copilot', `${platform}-${arch}`, binaryName);
    return existsSync(packaged) ? packaged : undefined;
  }

  return resolveUpwards(
    hostRuntime.appRootPath,
    join('node_modules', '@github', `copilot-${platform}-${arch}`, binaryName),
  );
}

function resolveServerPath(hostRuntime: BackendHostRuntimeContext, serverName: string): string | undefined {
  if (hostRuntime.isPackaged) {
    const packaged = join(hostRuntime.appRootPath, 'resources', serverName, 'index.js');
    return existsSync(packaged) ? packaged : undefined;
  }
  return resolveUpwards(
    hostRuntime.appRootPath,
    join('packages', serverName, 'dist', 'index.js'),
  );
}

function resolveRipgrepPath(hostRuntime: BackendHostRuntimeContext): string | undefined {
  const platform = process.platform === 'win32'
    ? 'x64-win32'
    : process.platform === 'darwin'
      ? (process.arch === 'arm64' ? 'arm64-darwin' : 'x64-darwin')
      : (process.arch === 'arm64' ? 'arm64-linux' : 'x64-linux');
  const binaryName = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const ripgrepRelative = join(
    'node_modules',
    '@anthropic-ai',
    'claude-agent-sdk',
    'vendor',
    'ripgrep',
    platform,
    binaryName,
  );

  if (hostRuntime.isPackaged) {
    const packaged = join(hostRuntime.appRootPath, ripgrepRelative);
    if (existsSync(packaged)) return packaged;
  }

  const fromHostRoot = resolveUpwards(hostRuntime.appRootPath, ripgrepRelative, 10);
  if (fromHostRoot) return fromHostRoot;

  const cwdFallback = join(process.cwd(), ripgrepRelative);
  if (existsSync(cwdFallback)) return cwdFallback;

  return undefined;
}

export function resolveBackendRuntimePaths(hostRuntime: BackendHostRuntimeContext): ResolvedBackendRuntimePaths {
  const bundledRuntimePath = hostRuntime.nodeRuntimePath || resolveBundledRuntimePath(hostRuntime);

  return {
    claudeCliPath: resolveClaudeCliPath(hostRuntime),
    claudeInterceptorPath: resolveClaudeInterceptorPath(hostRuntime),
    interceptorBundlePath: resolveInterceptorBundlePath(hostRuntime),
    copilotCliPath: resolveCopilotCliPath(hostRuntime),
    sessionServerPath: resolveServerPath(hostRuntime, 'session-mcp-server'),
    bridgeServerPath: resolveServerPath(hostRuntime, 'bridge-mcp-server'),
    piServerPath: resolveServerPath(hostRuntime, 'pi-agent-server'),
    nodeRuntimePath: hostRuntime.nodeRuntimePath || bundledRuntimePath || 'bun',
    bundledRuntimePath,
  };
}

export function resolveBackendHostTooling(hostRuntime: BackendHostRuntimeContext): ResolvedBackendHostTooling {
  return {
    ripgrepPath: resolveRipgrepPath(hostRuntime),
  };
}

/**
 * Configure anthropic-sdk globals from host runtime context.
 * This mirrors previous Electron bootstrap behavior but keeps it behind backend internals.
 */
export function applyAnthropicRuntimeBootstrap(
  hostRuntime: BackendHostRuntimeContext,
  paths: ResolvedBackendRuntimePaths,
): void {
  if (!paths.claudeCliPath) {
    throw new Error('Claude Code SDK not found. The app package may be corrupted.');
  }
  setPathToClaudeCodeExecutable(paths.claudeCliPath);

  if (!paths.claudeInterceptorPath) {
    throw new Error('Network interceptor not found. The app package may be corrupted.');
  }
  setInterceptorPath(paths.claudeInterceptorPath);

  if (hostRuntime.isPackaged) {
    if (paths.bundledRuntimePath) {
      setExecutable(paths.bundledRuntimePath);
    } else {
      // Graceful fallback: if the packaged Bun runtime is missing, try system bun.
      // This avoids hard-bricking packaged builds when vendor/bun is omitted.
      setExecutable('bun');
      console.warn('[runtime-resolver] Bundled Bun runtime missing in packaged app; falling back to bun on PATH.');
    }
  }
}
