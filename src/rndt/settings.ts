/**
 * Plugin settings and the log of failing service URLs. Both live in the
 * webview's localStorage: per user and per computer, never in the project.
 * Every access is guarded, so the panel works the same without storage.
 */

const SETTINGS_KEY = "openrndt-geolibre:settings";
const ERROR_LOG_KEY = "openrndt-geolibre:error-log";

/** Oldest entries leave the log past this size. */
export const ERROR_LOG_LIMIT = 1000;

export interface Settings {
  /** Keep a log of the service URLs that fail. Off by default. */
  logErrors: boolean;
}

export interface ErrorLogEntry {
  /** ISO 8601, UTC. */
  time: string;
  recordId: string;
  recordTitle: string;
  organisation: string;
  serviceKind: string;
  url: string;
  error: string;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  try {
    const text = storage()?.getItem(key);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the setting lasts for this session only.
  }
}

export function loadSettings(): Settings {
  const stored = readJson(SETTINGS_KEY) as Partial<Settings> | null;
  return { logErrors: stored?.logErrors === true };
}

export function saveSettings(settings: Settings): void {
  writeJson(SETTINGS_KEY, settings);
}

export function readErrorLog(): ErrorLogEntry[] {
  const stored = readJson(ERROR_LOG_KEY);
  return Array.isArray(stored) ? (stored as ErrorLogEntry[]) : [];
}

/** Add an entry, dropping the oldest past ERROR_LOG_LIMIT; returns the new size. */
export function appendErrorLog(entry: ErrorLogEntry): number {
  const log = [...readErrorLog(), entry].slice(-ERROR_LOG_LIMIT);
  writeJson(ERROR_LOG_KEY, log);
  return log.length;
}

export function clearErrorLog(): void {
  try {
    storage()?.removeItem(ERROR_LOG_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** One JSON object per line, oldest first. */
export function errorLogJsonl(log: ErrorLogEntry[]): string {
  return log.map((entry) => JSON.stringify(entry)).join("\n") + (log.length ? "\n" : "");
}
