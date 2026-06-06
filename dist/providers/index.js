"use strict";
/**
 * SchroDrive — Provider Abstraction Layer
 *
 * Defines the standard interface for debrid providers and a registry
 * for managing them. Adding a new provider requires only implementing
 * the DebridProvider interface and calling registry.register().
 *
 * @module providers
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registry = void 0;
// ===========================================================================
// ProviderRegistry
// ===========================================================================
var registry_1 = require("./registry");
Object.defineProperty(exports, "registry", { enumerable: true, get: function () { return registry_1.registry; } });
// ===========================================================================
// Auto-register providers
// ===========================================================================
// Import providers here so they self-register on module load.
// These imports MUST come AFTER registry is defined to avoid circular
// import issues — each provider file imports registry from this module.
require("./realdebrid");
require("./torbox");
require("./alldebrid");
require("./premiumize");
