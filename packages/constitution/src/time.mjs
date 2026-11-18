/**
 * ISO-8601 timestamps with a numeric offset (never Z-only).
 */
function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

export function formatIso(date = new Date()) {
  const offMin = -date.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function parseIso(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid timestamp: ${value}`);
  return d;
}

export function isExpired(expiresAt, now = new Date()) {
  return parseIso(expiresAt).getTime() <= now.getTime();
}
