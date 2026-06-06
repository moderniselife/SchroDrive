"use strict";
// Real-time log buffer and streaming system
Object.defineProperty(exports, "__esModule", { value: true });
exports.logBuffer = void 0;
class LogBuffer {
    constructor() {
        this.logs = [];
        this.maxLogs = 1000;
        this.listeners = new Set();
        this.idCounter = 0;
        this.interceptConsole();
    }
    interceptConsole() {
        const originalLog = console.log;
        const originalWarn = console.warn;
        const originalError = console.error;
        const originalDebug = console.debug;
        console.log = (...args) => {
            originalLog.apply(console, args);
            this.addLog("info", args);
        };
        console.warn = (...args) => {
            originalWarn.apply(console, args);
            this.addLog("warn", args);
        };
        console.error = (...args) => {
            originalError.apply(console, args);
            this.addLog("error", args);
        };
        console.debug = (...args) => {
            originalDebug.apply(console, args);
            this.addLog("debug", args);
        };
    }
    parseLogMessage(args) {
        const fullMessage = args
            .map((arg) => {
            if (typeof arg === "string")
                return arg;
            try {
                return JSON.stringify(arg);
            }
            catch {
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
    addLog(level, args) {
        const { service, message } = this.parseLogMessage(args);
        const entry = {
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
            }
            catch (err) {
                // Ignore listener errors
            }
        });
    }
    getLogs(limit = 100, level) {
        let filtered = this.logs;
        if (level && level !== "all") {
            filtered = filtered.filter((log) => log.level === level);
        }
        return filtered.slice(-limit);
    }
    subscribe(listener) {
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
exports.logBuffer = new LogBuffer();
