const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const SECRET = process.env.AUTH_SECRET || "change-me";
const sign = (s) => crypto.createHmac("sha256", SECRET).update(s).digest("hex");
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const mkToken = () => { const e = String(Date.now() + 12 * 3600e3); return e + "." + sign(e); };
const isAdmin = (req) => { const [e, s] = (req.headers.authorization || "").replace("Bearer ", "").split("."); return !!(e && s && same(s, sign(e)) && Date.now() < +e); };
const today = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10); // Казахстан UTC+5
const fails = {}; // простая защита от перебора пароля

async function rows(col, filter) {
  let q = sb.from("kv").select("id,data").eq("col", col);
  if (filter) q = filter(q);
  const { data, error } = await q;
  if (error) throw error;
  return data.map((r) => ({ id: r.id, ...r.data }));
}

module.exports = async (req, res) => {
  const a = req.query.action, b = req.body || {};
  const bad = (m, c = 400) => res.status(c).json({ error: m });
  try {
    if (a === "state") {
      const [menu, st, orders] = await Promise.all([
        rows("menu"), rows("settings"),
        rows("orders", (q) => q.eq("data->>date", today()).eq("data->>status", "paid")),
      ]);
      return res.json({ today: today(), menu, cfg: st.find((x) => x.id === "main") || {}, orders });
    }

    if (a === "order" && req.method === "POST") {
      const name = String(b.name || "").trim().slice(0, 40), dept = String(b.dept || "").slice(0, 60);
      if (!name || !dept || !Array.isArray(b.items) || !b.items.length) return bad("Заполните имя, департамент и блюда");
      const menu = await rows("menu"), items = [];
      for (const i of b.items) {
        const m = menu.find((x) => x.id === i.id), q = Math.floor(+i.q);
        if (!m || !(q > 0) || q > m.qty) return bad("Недостаточно порций: " + (m ? m.name : "блюдо"));
        items.push({ id: m.id, name: m.name, price: m.price, q }); // цена берётся с сервера
      }
      const total = items.reduce((s, i) => s + i.price * i.q, 0);
      const id = "o" + Date.now() + Math.random().toString(36).slice(2, 6);
      const { error } = await sb.from("kv").insert({ col: "orders", id, data: { date: today(), name, dept, items, total, status: "created", ts: Date.now() } });
      if (error) throw error;
      return res.json({ id, items, total });
    }

    if (a === "login" && req.method === "POST") {
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0], f = fails[ip] || { n: 0, t: Date.now() };
      if (Date.now() - f.t > 600e3) { f.n = 0; f.t = Date.now(); }
      if (f.n >= 8) return bad("Слишком много попыток, подождите 10 минут", 429);
      if (same(b.user || "", process.env.ADMIN_USER || "") && same(b.pass || "", process.env.ADMIN_PASSWORD || "")) { delete fails[ip]; return res.json({ token: mkToken() }); }
      f.n++; fails[ip] = f;
      return bad("Неверный логин или пароль", 401);
    }

    if (!isAdmin(req)) return bad("auth", 401);

    if (a === "admin") return res.json({ orders: await rows("orders") });

    if (a === "write" && req.method === "POST") {
      const { col, id, op, data } = b;
      if (!["menu", "settings", "orders"].includes(col) || !id) return bad("bad request");
      if (op === "delete") {
        const { error } = await sb.from("kv").delete().match({ col, id }); if (error) throw error;
      } else {
        let d = data || {};
        if (op === "update") {
          const { data: r } = await sb.from("kv").select("data").match({ col, id }).maybeSingle();
          d = { ...(r ? r.data : {}), ...d };
        }
        const { error } = await sb.from("kv").upsert({ col, id, data: d }); if (error) throw error;
      }
      return res.json({ ok: true });
    }
    return bad("not found", 404);
  } catch (e) { return bad(e.message || "server error", 500); }
};
