// Real-time log buffer and streaming system

export interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  service: string;
  message: string;
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
      .map((arg) => {
        if (typeof arg === "string") return arg;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(" ");

    // Parse service from log format: [timestamp][service] message
    const serviceMatch = fullMessage.match(/\]\[([^\]]+)\]/);
    const service = serviceMatch ? serviceMatch[1] : "system";

    // Remove timestamp prefix if present
    const cleanMessage = fullMessage.replace(/^\[[\d\-T:.Z]+\]/, "").trim();

    return { service, message: cleanMessage };
  }

  private addLog(level: LogEntry["level"], args: any[]) {
    const { service, message } = this.parseLogMessage(args);
    
    const entry: LogEntry = {
      id: `log-${++this.idCounter}`,
      timestamp: new Date().toISOString(),
      level,
      service,
      message,
    };

    this.logs.push(entry);

    // Trim old logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Notify listeners
    this.listeners.forEach((listener) => {
      try {
        listener(entry);
      } catch (err) {
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

// Singleton instance
export const logBuffer = new LogBuffer();
