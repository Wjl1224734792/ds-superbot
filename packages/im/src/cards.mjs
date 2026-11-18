/**
 * Card protocol: wraps constitution card renderers. Never sends a message.
 */
import {
  renderApprovalCard,
  renderCard as renderConstitutionCard,
  renderResultCard,
  renderWorkItemCard,
} from '../../constitution/src/cards.mjs';

export { renderApprovalCard, renderResultCard, renderWorkItemCard };

export function renderCard(kind, workItem, options) {
  return renderConstitutionCard(kind, workItem, options);
}
