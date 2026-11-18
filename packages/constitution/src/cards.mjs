/**
 * Pure-function renderers for the three group-chat cards.
 * Format is locked by contracts/templates and GOAL §8.3. These functions
 * never send a message.
 */

function yn(value) {
  return value ? '是' : '否';
}

function acLines(ac = []) {
  if (!ac.length) return '- （无）';
  return ac.map((item) => `- ${item.id} ${item.text ?? ''}`).join('\n');
}

function scopeLine(scope = {}) {
  const files = [...(scope.files ?? []), ...(scope.newFiles ?? [])];
  const owners = scope.owners ?? [];
  const filePart = files.length ? files.join(', ') : '（未声明）';
  const ownerPart = owners.length ? owners.join(', ') : '（未声明）';
  return `${filePart} ／ ${ownerPart}`;
}

function evidenceLine(workItem = {}) {
  const receipts = workItem.receipts ?? [];
  if (receipts.length) return receipts.join(', ');
  const origin = workItem.origin?.evidence ?? [];
  return origin.length ? origin.join(', ') : '（无）';
}

/**
 * @param {object} workItem
 * @returns {string}
 */
export function renderWorkItemCard(workItem) {
  const gates = (workItem.gates ?? []).join(', ') || '（无）';
  const nonGoals = (workItem.nonGoals ?? []).length ? workItem.nonGoals.join('；') : '（无）';
  return [
    `【工作项】${workItem.id}  状态：${workItem.state}`,
    `意图：${workItem.intent ?? ''}`,
    'AC：',
    acLines(workItem.ac),
    `非目标：${nonGoals}`,
    `风险：${workItem.risk}   可逆：${yn(workItem.reversible)}   授权：${workItem.authority}`,
    `范围 / 所有权：${scopeLine(workItem.scope)}`,
    `门禁：${gates}`,
    `证据：${evidenceLine(workItem)}`,
    `线程：${workItem.thread ?? ''}`,
  ].join('\n');
}

/**
 * @param {object} workItem
 * @returns {string}
 */
export function renderApprovalCard(workItem) {
  return [
    `【审批】${workItem.id}  请批 Mandate`,
    '请你确认或改：AC / 非目标 / 风险 / 文件范围',
    '批准后将签发不可变 Mandate，超时与文档漂移会自动吊销',
    '回复：批准 / 改 AC：… / 否决',
  ].join('\n');
}

/**
 * @param {object} workItem
 * @param {object} [options]
 * @param {string} [options.conclusion]
 * @param {Array<{ id: string, status: string, evidence?: string }>} [options.acResults]
 * @param {Array<{ gate: string, status: string }>} [options.receipts]
 * @param {string} [options.artifact]
 */
export function renderResultCard(workItem, options = {}) {
  const conclusion = String(options.conclusion ?? workItem.conclusion ?? workItem.intent ?? '').slice(0, 100);
  const acResults = options.acResults ?? (workItem.ac ?? []).map((item) => ({
    id: item.id,
    status: workItem.state === 'Delivered' ? '通过' : '失败',
    evidence: item.evidence ?? (item.coveredBy ?? []).join(', ') ?? '',
  }));
  const acText = acResults
    .map((row) => `${row.id} ${row.status}${row.evidence ? ` — ${row.evidence}` : ''}`)
    .join('；') || '（无）';
  const receipts = options.receipts
    ?? (workItem.receiptRecords ?? []).map((r) => `${r.gate} ${r.status}`);
  const receiptLine = Array.isArray(receipts)
    ? (receipts.length
      ? receipts.map((r) => (typeof r === 'string' ? r : `${r.gate} ${r.status}`)).join(', ')
      : '（无）')
    : String(receipts);
  const artifact = options.artifact ?? workItem.artifact ?? '（无）';
  return [
    `【结果】${workItem.id}  状态：${workItem.state}`,
    `结论：${conclusion}`,
    `AC 逐条：${acText}`,
    `Receipt：${receiptLine}`,
    `产物：${artifact}`,
    '请你：合并 / 打回',
  ].join('\n');
}

export function renderCard(kind, workItem, options) {
  if (kind === 'workitem') return renderWorkItemCard(workItem);
  if (kind === 'approval') return renderApprovalCard(workItem);
  if (kind === 'result') return renderResultCard(workItem, options);
  throw new Error(`unknown card kind: ${kind}`);
}
