import assert from 'node:assert/strict';
import test from 'node:test';
import * as runtime from '../src/index.mjs';

test('capabilityTier: light for Discover/Steward, strong for compiler and Verify', () => {
  assert.equal(runtime.capabilityTier('Discover', 'R0'), 'light');
  assert.equal(runtime.capabilityTier('Steward', 'R1'), 'light');
  assert.equal(runtime.capabilityTier('Scout', 'R1'), 'light');
  assert.equal(runtime.capabilityTier('Explorer', 'R0'), 'light');
  assert.equal(runtime.capabilityTier('Curator', 'R1'), 'light');
  assert.equal(runtime.capabilityTier('Cartographer', 'R1'), 'light');
  assert.equal(runtime.capabilityTier('Build', 'R1'), 'light');
  assert.equal(runtime.capabilityTier('Compiler', 'R0'), 'strong');
  assert.equal(runtime.capabilityTier('CapabilityCompiler', 'R1'), 'strong');
  assert.equal(runtime.capabilityTier('Verify', 'R0'), 'strong');
  assert.equal(runtime.capabilityTier('Verifier', 'R1'), 'strong');
  assert.equal(runtime.capabilityTier('Critic', 'R1'), 'strong');
});

test('R2/R3 raise the tier so compilation and verify never stay on the cheapest Discover model', () => {
  assert.equal(runtime.capabilityTier('Discover', 'R2'), 'strong');
  assert.equal(runtime.capabilityTier('Steward', 'R3'), 'strong');
  assert.equal(runtime.capabilityTier('Compiler', 'R3'), 'strong');
  assert.equal(runtime.capabilityTier('Verify', 'R2'), 'strong');
});

test('routeModel prefers capability×risk, then tier models, then modelRouting.<role>', () => {
  const config = {
    modelRouting: {
      'backend-dev': { model: 'acme/role-model', effort: 'high' },
    },
    modelTiers: {
      light: { model: 'acme/light', effort: 'low' },
      strong: { model: 'acme/strong', effort: 'high' },
    },
    modelRoutingByCapability: {
      'Verify:R3': { model: 'acme/critic', effort: 'max' },
    },
  };
  const explicit = runtime.routeModel({ capability: 'Verify', risk: 'R3', role: 'reviewer', config });
  assert.equal(explicit.source, 'capability-risk');
  assert.equal(explicit.model, 'acme/critic');
  assert.equal(explicit.tier, 'strong');

  const tiered = runtime.routeModel({ capability: 'Discover', risk: 'R1', role: 'pm', config });
  assert.equal(tiered.source, 'tier');
  assert.equal(tiered.model, 'acme/light');
  assert.equal(tiered.tier, 'light');

  const raised = runtime.routeModel({ capability: 'Discover', risk: 'R2', role: 'pm', config });
  assert.equal(raised.source, 'tier');
  assert.equal(raised.model, 'acme/strong');
  assert.equal(raised.tier, 'strong');

  const roleOnly = runtime.routeModel({
    role: 'backend-dev',
    config: { modelRouting: config.modelRouting },
  });
  assert.equal(roleOnly.source, 'role-fallback');
  assert.equal(roleOnly.model, 'acme/role-model');
});

test('malformed modelRouting.<role> degrades to inherit', () => {
  const out = runtime.routeModel({
    role: 'qa-engineer',
    config: { modelRouting: { 'qa-engineer': { model: 'no-slash' } } },
  });
  assert.equal(out.source, 'inherit');
  assert.equal(out.model, null);
  assert.equal(out.reason, 'malformed-role-routing');
});

test('createModelPort default stays rules-only regardless of a route', async () => {
  const route = runtime.routeModel({
    capability: 'Verify',
    risk: 'R2',
    config: { modelTiers: { strong: { model: 'acme/strong' } } },
  });
  assert.equal(route.tier, 'strong');
  const port = runtime.createModelPort();
  assert.equal(port.kind, 'rules');
  const out = await port.complete('classify-signal', { text: 'CI is red' });
  assert.equal(out.via, 'rules');
});
