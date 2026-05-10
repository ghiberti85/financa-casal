function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((c) => {
        const [k, ...v] = c.trim().split("=");
        return [k.trim(), decodeURIComponent(v.join("="))];
      })
      .filter(([k]) => k)
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const cookies = parseCookies(req);
  const refreshToken = cookies.sb_refresh;

  if (!refreshToken) return res.status(401).json({ error: "Sem sessão ativa" });

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

  const clearCookie =
    "sb_refresh=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/";

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) {
      res.setHeader("Set-Cookie", clearCookie);
      return res.status(401).json({ error: "Sessão expirada" });
    }

    const data = await response.json();

    if (!data.access_token) {
      res.setHeader("Set-Cookie", clearCookie);
      return res.status(401).json({ error: "Sessão expirada" });
    }

    // Rotate refresh token on every use
    res.setHeader(
      "Set-Cookie",
      `sb_refresh=${data.refresh_token}; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000; Path=/`
    );

    return res.status(200).json({ access_token: data.access_token, user: data.user });
  } catch {
    return res.status(500).json({ error: "Erro interno no servidor" });
  }
}
