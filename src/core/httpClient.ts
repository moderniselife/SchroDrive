/**
 * SchroDrive — Shared HTTP Client
 *
 * Pre-configured axios instance forced to IPv4 to avoid IPv6 timeout
 * issues common in Docker containers. Previously duplicated across
 * provider and service files.
 *
 * @module core/httpClient
 */

import axios, { type AxiosRequestConfig } from 'axios';
import http from 'http';
import https from 'https';

export const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_TIMEOUT_MS = 120_000;

/** Force IPv4 to avoid IPv6 timeout issues in Docker containers. */
const httpAgent = new http.Agent({ family: 4 });
const httpsAgent = new https.Agent({ family: 4 });

export function requestTimeoutMs(customTimeoutMs?: number, maxMs = MAX_TIMEOUT_MS, defaultMs = DEFAULT_TIMEOUT_MS): number {
  return Math.max(5_000, Math.min(customTimeoutMs ?? defaultMs, maxMs));
}

export function buildRequestConfig(config: AxiosRequestConfig = {}): AxiosRequestConfig {
  const timeout = typeof config.timeout === 'number' ? config.timeout : DEFAULT_TIMEOUT_MS;
  return {
    ...config,
    timeout: requestTimeoutMs(timeout, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
}

/**
 * Axios instance configured to use IPv4 only.
 * Use this instead of bare `axios` for all provider/service HTTP requests.
 */
export const axiosIPv4 = axios.create({ httpAgent, httpsAgent });
