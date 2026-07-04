/**
 * SchroDrive — Shared HTTP Client
 *
 * Pre-configured axios instance forced to IPv4 to avoid IPv6 timeout
 * issues common in Docker containers. Previously duplicated across
 * 13+ provider and service files.
 *
 * @module core/httpClient
 */

import axios from 'axios';
import http from 'http';
import https from 'https';

/** Force IPv4 to avoid IPv6 timeout issues in Docker containers. */
const httpAgent = new http.Agent({ family: 4 });
const httpsAgent = new https.Agent({ family: 4 });

/**
 * Axios instance configured to use IPv4 only.
 * Use this instead of bare `axios` for all provider/service HTTP requests.
 */
export const axiosIPv4 = axios.create({ httpAgent, httpsAgent });
