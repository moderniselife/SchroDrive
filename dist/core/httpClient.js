"use strict";
/**
 * SchroDrive — Shared HTTP Client
 *
 * Pre-configured axios instance forced to IPv4 to avoid IPv6 timeout
 * issues common in Docker containers. Previously duplicated across
 * 13+ provider and service files.
 *
 * @module core/httpClient
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.axiosIPv4 = void 0;
const axios_1 = __importDefault(require("axios"));
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
/** Force IPv4 to avoid IPv6 timeout issues in Docker containers. */
const httpAgent = new http_1.default.Agent({ family: 4 });
const httpsAgent = new https_1.default.Agent({ family: 4 });
/**
 * Axios instance configured to use IPv4 only.
 * Use this instead of bare `axios` for all provider/service HTTP requests.
 */
exports.axiosIPv4 = axios_1.default.create({ httpAgent, httpsAgent });
