// Real-time log buffer and streaming system.
// The project was previously logging ad-hoc timestamp prefixes in many modules;
// this central abstraction keeps event-scoped output consistent.

export interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  service: string;
  message: string;
}

type LogListener = (entry: LogEntry) => void;

export function getLogTimestamp(): string {
  return new Date().toISOString();
}

export function formatLogPrefix(service: string): string {
  return `[${getLogTimestamp()}][${service}]`;
}

function safeSerialize(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function createLogger(service: string) {
  return {
    info: (message: string, data?: Record<string, unknown>) => logInfo(service, message, data),
    warn: (message: string, data?: Record<string, unknown>) => logWarn(service, message, data),
    error: (message: string, data?: Record<string, unknown>) => logError(service, message, data),
    debug: (message: string, data?: Record<string, unknown>) => logDebug(service, message, data),
  };
}

export function logInfo(service: string, message: string, data?: Record<string, unknown>): void {
  const prefix = formatLogPrefix(service);
  if (data) {
    console.log(prefix, message, data);
    return;
  }
  console.log(prefix, message);
}

export function logWarn(service: string, message: string, data?: Record<string, unknown>): void {
  const prefix = formatLogPrefix(service);
  if (data) {
    console.warn(prefix, message, data);
    return;
  }
  console.warn(prefix, message);
}

export function logError(service: string, message: string, data?: Record<string, unknown>): void {
  const prefix = formatLogPrefix(service);
  if (data) {
    console.error(prefix, message, data);
    return;
  }
  console.error(prefix, message);
}

export function logDebug(service: string, message: string, data?: Record<string, unknown>): void {
  const prefix = formatLogPrefix(service);
  if (data) {
    console.debug(prefix, message, data);
    return;
  }
  console.debug(prefix, message);
}

type LogListener = (entry: LogEntry) => void;

class LogBuffer {
  private logs: LogEntry[] = [];
  private maxLogs = 1000;
  private listeners: Set<LogListener> = new Set();
  private idCounter = 0;

  constructor() {
    this.interceptConsole();
  }

  private interceptConsole() {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalDebug = console.debug;

    console.log = (...args: any[]) => {
      originalLog.apply(console, args);
      this.addLog("info", args);
    };

    console.warn = (...args: any[]) => {
      originalWarn.apply(console, args);
      this.addLog("warn", args);
    };

    console.error = (...args: any[]) => {
      originalError.apply(console, args);
      this.addLog("error", args);
    };

    console.debug = (...args: any[]) => {
      originalDebug.apply(console, args);
      this.addLog("debug", args);
    };
  }

  private parseLogMessage(args: any[]): { service: string; message: string } {
    const fullMessage = args
      .map((arg) => safeSerialize(arg))
      .join(" ");

    const serviceMatch = fullMessage.match(/\]\[([^\]]+)\]/);
    const service = serviceMatch ? serviceMatch[1] : "system";

    const cleanMessage = fullMessage.replace(/^\[[\d\-T:.Z]+\]/, "").trim();

    return { service, message: cleanMessage };
  }

  private addLog(level: LogEntry["level"], args: any[]) {
    const { service, message } = this.parseLogMessage(args);

    const entry: LogEntry = {
      id: `log-${++this.idCounter}`,
      timestamp: getLogTimestamp(),
      level,
      service,
      message,
    };

    this.logs.push(entry);

    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    this.listeners.forEach((listener) => {
      try {
        listener(entry);
      } catch {
        // Ignore listener errors
      }
    });
  }

  getLogs(limit = 100, level?: string): LogEntry[] {
    let filtered = this.logs;
    if (level && level !== "all") {
      filtered = filtered.filter((log) => log.level === level);
    }
    return filtered.slice(-limit);
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clear() {
    this.logs = [];
  }
}

export const logBuffer = new LogBuffer();
