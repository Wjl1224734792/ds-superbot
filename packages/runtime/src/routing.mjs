/**
 * Model routing by capability state × risk (Goal §2 / §9 P3).
 *
 * Light tier: Discover, Steward, Scout, Explorer, Curator, Cartographer, Build.
 * Strong tier: Capability Compiler (contract compilation), Verify / Verifier / Critic.
 *
 * Risk raises the tier: R2 / R3 always resolve to strong, so compilation
 * and final verification never stay on the cheapest Discover model.
 * R0 / R1 keep the capability's base tier (light stays light, strong stays strong).
 *
 * `superbot.config.json` `modelRouting.<role>` is a lower-priority
 * fallback when no capability×risk (or tier) route is provided. This
 * function is a pure helper the plugin may call later; it does not
 * rewrite `superbot_dispatch` or touch the network.
 * `createModelPort()` remains rules-only.
 *
 * Malformed `modelRouting.<role>` entries (missing model, or model
 * without a `provider/name` slash, matching the 0.1.0 plugin) are
 * ignored and degrade to `source: 'inherit'`.
 */
export const RISK_RANK = Object.freeze({ R0: 0, R1: 1, R2: 2, R3: 3 });

export const LIGHT_CAPABILITIES = Object.freeze([
  'Discover',
  'Steward',
  'Scout',
  'Explorer',
  'Curator',
  'Cartographer',
  'Build',
  'Worker',
]);

export const STRONG_CAPABILITIES = Object.freeze([
  'Compiler',
  'CapabilityCompiler',
  'Verify',
  'Verifier',
  'Critic',
]);

const LIGHT = new Set(LIGHT_CAPABILITIES.map((s) => s.toLowerCase()));
const STRONG = new Set(STRONG_CAPABILITIES.map((s) => s.toLowerCase()));

function normalizeCapability(capability) {
  if (capability == null || capability === '') return null;
  return String(capability);
}

function capKey(capability) {
  return String(capability).toLowerCase().replace(/[\s_]+/g, '');
}

/**
 * @param {string|null|undefined} capability
 * @param {string|null|undefined} risk  R0–R3
 * @returns {'light'|'strong'}
 */
export function capabilityTier(capability, risk) {
  const key = capability != null ? capKey(capability) : '';
  let tier = 'light';
  if (STRONG.has(capability) || STRONG.has(key) || key === 'capabilitycompiler') {
    tier = 'strong';
  } else if (LIGHT.has(capability) || LIGHT.has(key)) {
    tier = 'light';
  } else if (key) {
    // Unknown capability names default to light; risk may still raise.
    tier = 'light';
  }
  const rank = RISK_RANK[risk] ?? 0;
  if (rank >= 2) tier = 'strong';
  return tier;
}

/**
 * A usable 0.1.0-style role routing entry has a model string that
 * includes a provider/name slash. Anything else is treated as absent.
 */
export function isUsableRoleRoute(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const model = entry.model;
  if (typeof model !== 'string' || !model.includes('/')) return false;
  return true;
}

function asRoute(entry, extra) {
  if (!isUsableRoleRoute(entry) && !(entry && typeof entry.model === 'string' && extra.source === 'tier')) {
    return null;
  }
  if (!entry || typeof entry !== 'object' || typeof entry.model !== 'string' || !entry.model) return null;
  return {
    provider: entry.provider ?? null,
    model: entry.model,
    effort: entry.effort ?? null,
    ...extra,
  };
}

function lookupExplicit(routes, capability, risk, tier) {
  if (!routes || typeof routes !== 'object') return null;
  const names = [];
  if (capability && risk) names.push(`${capability}:${risk}`, `${capability}-${risk}`);
  if (capability && tier) names.push(`${capability}:${tier}`);
  if (capability) names.push(capability);
  if (tier) names.push(tier);
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(routes, name) && routes[name]) {
      const hit = routes[name];
      if (typeof hit === 'string') return { provider: null, model: hit, effort: null };
      if (typeof hit === 'object' && typeof hit.model === 'string' && hit.model) {
        return { provider: hit.provider ?? null, model: hit.model, effort: hit.effort ?? null };
      }
    }
  }
  return null;
}

function lookupTierModel(config, tier) {
  if (!tier || !config) return null;
  const tiers = config.modelTiers ?? config.tierModels ?? null;
  if (!tiers || typeof tiers !== 'object') return null;
  const entry = tiers[tier];
  if (typeof entry === 'string' && entry) return { provider: null, model: entry, effort: null };
  if (entry && typeof entry === 'object' && typeof entry.model === 'string' && entry.model) {
    return { provider: entry.provider ?? null, model: entry.model, effort: entry.effort ?? null };
  }
  return null;
}

/**
 * Pure function: pick a model route from capability × risk, then
 * role-level `config.modelRouting[role]` as fallback, then inherit.
 *
 * @param {{ capability?: string, risk?: string, role?: string, config?: object }} input
 * @returns {{
 *   provider: string|null,
 *   model: string|null,
 *   effort: string|null,
 *   tier: 'light'|'strong'|null,
 *   source: 'capability-risk'|'tier'|'role-fallback'|'inherit',
 *   capability: string|null,
 *   risk: string|null,
 *   role: string|null,
 *   reason?: string
 * }}
 */
export function routeModel(input = {}) {
  const capability = normalizeCapability(input.capability);
  const risk = input.risk ?? null;
  const role = input.role ?? null;
  const config = input.config ?? {};
  const hasCapOrRisk = capability != null || (risk != null && RISK_RANK[risk] != null);
  const tier = hasCapOrRisk ? capabilityTier(capability ?? 'Discover', risk) : (risk ? capabilityTier('Discover', risk) : null);

  const explicitTable = config.modelRoutingByCapability ?? config.capabilityRouting ?? input.routes ?? null;
  const explicit = lookupExplicit(explicitTable, capability, risk, tier);
  if (explicit) {
    return {
      ...explicit,
      tier,
      source: 'capability-risk',
      capability,
      risk,
      role,
    };
  }

  const tierRoute = lookupTierModel(config, tier);
  if (tierRoute) {
    return {
      ...tierRoute,
      tier,
      source: 'tier',
      capability,
      risk,
      role,
    };
  }

  const roleEntry = role ? config.modelRouting?.[role] : null;
  if (role && isUsableRoleRoute(roleEntry)) {
    return {
      provider: roleEntry.provider ?? null,
      model: roleEntry.model,
      effort: roleEntry.effort ?? null,
      tier,
      source: 'role-fallback',
      capability,
      risk,
      role,
    };
  }

  return {
    provider: null,
    model: null,
    effort: null,
    tier,
    source: 'inherit',
    capability,
    risk,
    role,
    reason: roleEntry ? 'malformed-role-routing' : 'no-route',
  };
}

export { asRoute };
