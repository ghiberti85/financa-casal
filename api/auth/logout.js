export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  res.setHeader(
    "Set-Cookie",
    "sb_refresh=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/"
  );

  return res.status(200).json({ ok: true });
}
