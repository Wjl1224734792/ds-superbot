// P1: not implemented — subscription pass-through does not grant authority.
import { notImplemented } from './errors.mjs';

export function connect(_channel) {
  notImplemented('subscribe.connect');
}

export function ingest(_event) {
  notImplemented('subscribe.ingest');
}
