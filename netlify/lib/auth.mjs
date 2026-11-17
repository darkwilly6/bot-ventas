import crypto from "node:crypto";

const secret = () => process.env.ADMIN_PASSWORD || "";

export function makeToken(days = 30) {
  const exp = Date.now() + days * 86400000;
  const sig = crypto.createHmac("sha256", secret()).update(String(exp)).digest("hex");
  return `${exp}.${sig}`;
}

export function checkToken(token) {
  if (!secret() || !token) return false;
  const [exp, sig] = String(token).split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = crypto.createHmac("sha256", secret()).update(String(exp)).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(good);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function checkPassword(pw) {
  const s = secret();
  if (!s) return false;
  const a = crypto.createHash("sha256").update(String(pw)).digest();
  const b = crypto.createHash("sha256").update(s).digest();
  return crypto.timingSafeEqual(a, b);
}
