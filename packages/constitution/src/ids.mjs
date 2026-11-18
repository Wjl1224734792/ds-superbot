/**
 * ID generation and validation for ds-superbot constitution objects.
 */
const WI = /^WI-([0-9]{4})-([0-9]{3,})$/;
const TH = /^TH-([a-z0-9-]{1,64})$/;
const MD = /^MD-(WI-[0-9]{4}-[0-9]{3,})$/;
const RC = /^RC-([a-z0-9-]+)-([0-9a-f]{8})$/;
const CS = /^CS-([0-9a-f]{12})$/;
const AC = /^AC-[A-Za-z0-9._-]+$/;

export const ID = { WI, TH, MD, RC, CS, AC };

export function isWorkItemId(id) { return WI.test(id); }
export function isThreadId(id) { return TH.test(id); }
export function isMandateId(id) { return MD.test(id); }
export function isReceiptId(id) { return RC.test(id); }
export function isSnapshotId(id) { return CS.test(id); }
export function isAcId(id) { return AC.test(id); }

export function mandateIdFor(workItemId) {
  if (!isWorkItemId(workItemId)) throw new Error(`invalid work item id: ${workItemId}`);
  return `MD-${workItemId}`;
}

export function threadId(slug) {
  const cleaned = String(slug ?? '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,64}$/.test(cleaned)) {
    throw new Error(`invalid thread slug: ${slug}`);
  }
  return `TH-${cleaned}`;
}

/**
 * Next WI-YYYY-NNN for the given year, based on existing ids.
 * @param {string[]} existing
 * @param {number} [year]
 */
export function nextWorkItemId(existing, year = new Date().getFullYear()) {
  const y = String(year);
  let max = 0;
  for (const id of existing) {
    const m = WI.exec(id);
    if (m && m[1] === y) max = Math.max(max, Number(m[2]));
  }
  return `WI-${y}-${String(max + 1).padStart(3, '0')}`;
}

export function receiptId(gate, hex8) {
  if (!/^[a-z0-9-]+$/.test(gate)) throw new Error(`invalid gate for receipt id: ${gate}`);
  if (!/^[0-9a-f]{8}$/.test(hex8)) throw new Error(`invalid receipt suffix: ${hex8}`);
  return `RC-${gate}-${hex8}`;
}

export function snapshotId(hex12) {
  if (!/^[0-9a-f]{12}$/.test(hex12)) throw new Error(`invalid snapshot suffix: ${hex12}`);
  return `CS-${hex12}`;
}
