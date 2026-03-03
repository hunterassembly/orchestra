/**
 * Centralized path configuration for Craft Agent.
 *
 * Supports multi-instance development via CRAFT_CONFIG_DIR environment variable.
 * When running from a numbered folder (e.g., craft-tui-agent-1), the detect-instance.sh
 * script sets CRAFT_CONFIG_DIR to ~/.craft-agent-1, allowing multiple instances to run
 * simultaneously with separate configurations.
 *
 * Default (non-numbered folders): ~/.craft-agent/
 * Instance 1 (-1 suffix): ~/.craft-agent-1/
 * Instance 2 (-2 suffix): ~/.craft-agent-2/
 */

import { homedir } from 'os';
import { join } from 'path';

function detectDefaultConfigDir(): string {
  const home = homedir();

  // If this is a packaged Electron "Orchestra Dev" app launch, default to
  // a separate config root so double-clicking the Dev app is isolated by default.
  const isElectron = typeof process !== 'undefined' && !!process.versions?.electron;
  if (isElectron) {
    const execHint = `${process.execPath ?? ''} ${process.argv0 ?? ''}`.toLowerCase();
    if (execHint.includes('orchestra dev') || execHint.includes('orchestradev')) {
      return join(home, '.craft-agent-dev');
    }
  }

  return join(home, '.craft-agent');
}

// Allow override via environment variable for multi-instance dev
// Falls back to default ~/.craft-agent/ for production and non-numbered dev folders
export const CONFIG_DIR = process.env.CRAFT_CONFIG_DIR || detectDefaultConfigDir();
