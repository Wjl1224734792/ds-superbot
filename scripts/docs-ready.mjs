#!/usr/bin/env node
/**
 * Compatibility shim at the install entry (repository root).
 * Forwards to the constitution SSOT. Exit codes and --help stay the same.
 * Do not change judgment semantics here.
 */
import '../packages/constitution/scripts/docs-ready.mjs';
