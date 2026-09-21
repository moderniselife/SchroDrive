"use strict";
/**
 * SchroDrive — Shared HTTP Client
 *
 * Pre-configured axios instance forced to IPv4 to avoid IPv6 timeout
 * issues common in Docker containers. Previously duplicated across
 * provider and service files.
 *
 * @module core/httpClient
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.axiosIPv4 = exports.MAX_TIMEOUT_MS = exports.DEFAULT_TIMEOUT_MS = void 0;
exports.requestTimeoutMs = requestTimeoutMs;
exports.buildRequestConfig = buildRequestConfig;
const axios_1 = __importDefault(require("axios"));
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
exports.DEFAULT_TIMEOUT_MS = 15000;
exports.MAX_TIMEOUT_MS = 120000;
/** Force IPv4 to avoid IPv6 timeout issues in Docker containers. */
const httpAgent = new http_1.default.Agent({ family: 4 });
const httpsAgent = new https_1.default.Agent({ family: 4 });
function requestTimeoutMs(customTimeoutMs, maxMs = exports.MAX_TIMEOUT_MS, defaultMs = exports.DEFAULT_TIMEOUT_MS) {
    return Math.max(5000, Math.min(customTimeoutMs ?? defaultMs, maxMs));
}
function buildRequestConfig(config = {}) {
    const timeout = typeof config.timeout === 'number' ? config.timeout : exports.DEFAULT_TIMEOUT_MS;
    return {
        ...config,
        timeout: requestTimeoutMs(timeout, exports.MAX_TIMEOUT_MS, exports.DEFAULT_TIMEOUT_MS),
    };
}
/**
 * Axios instance configured to use IPv4 only.
 * Use this instead of bare `axios` for all provider/service HTTP requests.
 */
exports.axiosIPv4 = axios_1.default.create({ httpAgent, httpsAgent });
