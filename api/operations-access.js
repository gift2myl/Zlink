const { timingSafeEqual } = require('node:crypto');

const failures = new Map();
const windowMs = 15 * 60 * 1000;
const maxAttempts = 5;
let nextCleanup = 0;

module.exports = function operationsAccess(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  if (!req.headers['content-type']?.startsWith('application/json')) return res.status(415).end();

  const now = Date.now();
  if (now >= nextCleanup) {
    for (const [id, entry] of failures) if (entry.until <= now) failures.delete(id);
    nextCleanup = now + windowMs;
  }
  const ip = req.headers['x-vercel-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  let entry = failures.get(ip);
  if (entry?.until <= now) entry = undefined;
  if (entry?.count >= maxAttempts) {
    res.setHeader('Retry-After', String(Math.ceil((entry.until - now) / 1000)));
    return res.status(429).end();
  }

  let settings;
  try { settings = JSON.parse(process.env.ZLINK_OPERATIONS_ACCESS); } catch { return res.status(503).end(); }
  if (typeof settings?.pin !== 'string' || !/^\d{4}$/.test(settings.pin)
      || typeof settings.key !== 'string' || !/^[\w-]{43}$/.test(settings.key)) return res.status(503).end();
  const pin = req.body?.pin;
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin) || !timingSafeEqual(Buffer.from(pin), Buffer.from(settings.pin))) {
    failures.set(ip, { count:(entry?.count || 0) + 1, until:entry?.until || now + windowMs });
    return res.status(401).end();
  }
  failures.delete(ip);
  return res.status(200).json({ key:settings.key });
};
