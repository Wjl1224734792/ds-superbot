#!/usr/bin/env node
/**
 * Compatibility shim: forward to the constitution package SSOT.
 * Exit codes and --help text come from the original script. Do not change
 * judgment semantics here.
 */
import '../../constitution/scripts/doc-snapshot.mjs';
