"use strict";
// Real-time log buffer and streaming system.
// The project was previously logging ad-hoc timestamp prefixes in many modules;
// this central abstraction keeps event-scoped output consistent.
Object.defineProperty(exports, "__esModule", { value: true });
exports.logBuffer = void 0;
exports.getLogTimestamp = getLogTimestamp;
exports.formatLogPrefix = formatLogPrefix;
exports.createLogger = createLogger;
exports.logInfo = logInfo;
exports.logWarn = logWarn;
exports.logError = logError;
exports.logDebug = logDebug;
function getLogTimestamp() {
    return new Date().toISOString();
}
function formatLogPrefix(service) {
    return `[${getLogTimestamp()}][${service}]`;
}
function safeSerialize(value) {
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function createLogger(service) {
    return {
        info: (message, data) => logInfo(service, message, data),
        warn: (message, data) => logWarn(service, message, data),
        error: (message, data) => logError(service, message, data),
        debug: (message, data) => logDebug(service, message, data),
    };
}
function logInfo(service, message, data) {
    const prefix = formatLogPrefix(service);
    if (data) {
        console.log(prefix, message, data);
        return;
    }
    console.log(prefix, message);
}
function logWarn(service, message, data) {
    const prefix = formatLogPrefix(service);
    if (data) {
        console.warn(prefix, message, data);
        return;
    }
    console.warn(prefix, message);
}
function logError(service, message, data) {
    const prefix = formatLogPrefix(service);
    if (data) {
        console.error(prefix, message, data);
        return;
    }
    console.error(prefix, message);
}
function logDebug(service, message, data) {
    const prefix = formatLogPrefix(service);
    if (data) {
        console.debug(prefix, message, data);
        return;
    }
    console.debug(prefix, message);
}
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
            .map((arg) => safeSerialize(arg))
            .join(" ");
        const serviceMatch = fullMessage.match(/\]\[([^\]]+)\]/);
        const service = serviceMatch ? serviceMatch[1] : "system";
        const cleanMessage = fullMessage.replace(/^\[[\d\-T:.Z]+\]/, "").trim();
        return { service, message: cleanMessage };
    }
    addLog(level, args) {
        const { service, message } = this.parseLogMessage(args);
        const entry = {
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
            }
            catch {
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
exports.logBuffer = new LogBuffer();
