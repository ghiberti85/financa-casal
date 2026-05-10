// In-memory rate limiter (best-effort for serverless — resets on cold start)
// Supabase also enforces its own rate limiting as a second layer of protection.
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;

function getIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return (forwarded ? forwarded.split(",")[0].trim() : req.socket?.remoteAddress) || "unknown";
}

function isRateLimited(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) {
    attempts.set(ip, { count: 1, first: now });
    return false;
  }
  rec.count++;
  return rec.count > MAX_ATTEMPTS;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const ip = getIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos." });
  }

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email e senha são obrigatórios" });
  }

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      return res.status(response.status || 400).json({
        error: data.error_description || data.error || "Erro de autenticação",
      });
    }

    // Refresh token stored as HttpOnly cookie — inaccessible to JavaScript
    res.setHeader(
      "Set-Cookie",
      `sb_refresh=${data.refresh_token}; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000; Path=/`
    );

    return res.status(200).json({ access_token: data.access_token, user: data.user });
  } catch {
    return res.status(500).json({ error: "Erro interno no servidor" });
  }
}
