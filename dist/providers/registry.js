"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registry = void 0;
const config_1 = require("../core/config");
/**
 * Manages the lifecycle and lookup of registered debrid providers.
 */
class ProviderRegistry {
    constructor() {
        this.providers = new Map();
    }
    /**
     * Registers a provider instance. Typically called at module level
     * by each provider's source file.
     *
     * @param provider - The provider instance to register.
     */
    register(provider) {
        this.providers.set(provider.id, provider);
        console.log(`[${new Date().toISOString()}][providers] registered: ${provider.displayName} (${provider.id})`);
    }
    /**
     * Retrieves a provider by its unique identifier.
     *
     * @param id - The provider identifier (e.g. `'realdebrid'`).
     * @returns The provider instance, or `undefined` if not registered.
     */
    get(id) {
        return this.providers.get(id);
    }
    /** Returns all registered providers (configured or not). */
    all() {
        return Array.from(this.providers.values());
    }
    /** Returns only providers that have valid API credentials configured. */
    configured() {
        return this.all().filter(p => p.isConfigured());
    }
    /**
     * Returns configured providers in the user's preferred order.
     *
     * @returns An ordered array of configured providers.
     */
    ordered() {
        const order = config_1.config.providers; // e.g. ['torbox', 'realdebrid']
        const configured = this.configured();
        const ordered = [];
        for (const id of order) {
            const p = configured.find(c => c.id === id);
            if (p)
                ordered.push(p);
        }
        // Append any configured providers not in the order list
        for (const p of configured) {
            if (!ordered.includes(p))
                ordered.push(p);
        }
        return ordered;
    }
    /**
     * Checks all configured providers for an existing torrent with a similar title.
     *
     * @param title - The title to search for among existing torrents.
     * @returns An object indicating whether a match was found and which provider.
     */
    async checkExistingAcrossAll(title) {
        for (const p of this.configured()) {
            try {
                if (await p.checkExisting(title)) {
                    return { exists: true, provider: p.id };
                }
            }
            catch (e) {
                console.warn(`[${new Date().toISOString()}][providers] ${p.id} duplicate check failed`, { err: e?.message });
            }
        }
        return { exists: false };
    }
    /**
     * Adds a magnet link using the configured strategy.
     *
     * @param magnet - The magnet URI to add.
     * @param name - Optional human-readable name for the torrent.
     * @param strategy - The distribution strategy. Defaults to `'all'`.
     * @returns An object containing per-provider results.
     */
    async addMagnetWithStrategy(magnet, name, strategy = 'all') {
        const providers = this.ordered();
        const results = [];
        let legallyBlocked = false;
        for (const p of providers) {
            try {
                console.log(`[${new Date().toISOString()}][providers] adding magnet to ${p.id}`, { name });
                const result = await p.addMagnet(magnet, name);
                console.log(`[${new Date().toISOString()}][providers] ✅ added to ${p.id}`, { id: result.id });
                results.push({ provider: p.id, success: true, result });
                if (strategy === 'failover' || strategy === 'single') {
                    break; // Success — don't try more providers
                }
            }
            catch (err) {
                const error = err?.message || String(err);
                const status = err?.response?.status || err?.status;
                console.warn(`[${new Date().toISOString()}][providers] ❌ ${p.id} add failed`, { error });
                results.push({ provider: p.id, success: false, error });
                // HTTP 451 = Unavailable For Legal Reasons — auto-blacklist
                if (status === 451) {
                    legallyBlocked = true;
                    console.warn(`[${new Date().toISOString()}][providers] ⚖️ ${p.id} returned 451 (legally blocked)`, { name });
                }
                if (strategy === 'single') {
                    break; // Only try one
                }
            }
        }
        // If ANY provider returned 451, auto-blacklist this torrent so we never retry it
        if (legallyBlocked && name) {
            const { addToBlacklist, isBlacklisted } = await Promise.resolve().then(() => __importStar(require('../core/blacklist')));
            if (!isBlacklisted(name)) {
                addToBlacklist(name, 'HTTP 451 — Unavailable For Legal Reasons', 'auto');
                console.log(`[${new Date().toISOString()}][providers] ⚖️ auto-blacklisted "${name}" (451 legally blocked)`);
            }
        }
        return { results };
    }
}
/** Singleton registry instance shared across the application. */
exports.registry = new ProviderRegistry();
