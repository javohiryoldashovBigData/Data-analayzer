// ============================================================================
// MAKTAB+ API server (step 1)
//
// Thin layer between the web app and PostgreSQL. It holds NO permission logic:
// every request runs inside a transaction as the database role `anon`
// (visitor) or `authenticated` + the user's id, so the RLS policies decide
// what comes back. The server connects as `authenticator`, which cannot read
// anything on its own.
//
// Env: DATABASE_URL (postgres://authenticator:...@host:port/db)
//      SESSION_SECRET (random, long)   PORT (default 8787)
// ============================================================================
import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";

const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
// dates stay plain "YYYY-MM-DD" text (no timezone shift); numbers as numbers
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const ROLES = ["director", "zavuch", "school_admin", "teacher", "parent", "student"];
const SESSION_HOURS = 12;

// ---- session token: base64url(payload).hmac — small, no extra library -------
const b64 = (s) => Buffer.from(s).toString("base64url");
function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const good = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  const p = JSON.parse(Buffer.from(body, "base64url").toString());
  return p.exp > Date.now() ? p : null;
}

// ---- run queries as a database role (RLS applies) ---------------------------
async function asRole(user, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    if (user) {
      await c.query("set local role authenticated");
      await c.query("select set_config('app.current_user_id', $1, true)", [user.sub]);
    } else {
      await c.query("set local role anon");
    }
    const out = await fn((sql, params) => c.query(sql, params).then((r) => r.rows));
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// ---- what each home screen needs (read-only; RLS filters every row) ---------
const Q = {
  me: `select p.first_name, p.last_name from profiles p where p.user_id = auth.uid()`,
  mySchools: `select school_id, slug, name, roles::text[] as roles from app.my_schools()`,
  myDay: `select api.my_day(current_date) as day`,
  kids: `select s.id, s.first_name, s.last_name, c.grade_level || '-' || c.letter as class, c.id as class_id
         from students s join class_members cm on cm.student_id = s.id and cm.status = 'active'
         join classes c on c.id = cm.class_id
         where s.user_id = auth.uid()
            or exists (select 1 from guardians g where g.student_id = s.id and g.parent_user_id = auth.uid())
         order by c.grade_level desc`,
  gateToday: `select student_id, direction, scanned_at from gate_events
              where scanned_at >= (current_date::timestamp at time zone 'Asia/Tashkent') order by scanned_at`,
  grades: `select g.student_id, g.value, g.grade_type, g.comment, g.created_at, sub.name_uz as subject
           from grades g join subjects sub on sub.id = g.subject_id
           where g.deleted_at is null order by g.created_at desc limit 40`,
  attendance30: `select student_id,
                   count(*) filter (where status in ('present','late')) as present,
                   count(*) filter (where status = 'late') as late,
                   count(*) filter (where status = 'absent') as absent,
                   count(*) as total
                 from attendance_logs where date >= current_date - 30 group by student_id`,
  homework: `select h.class_id, h.description, h.due_date, sub.name_uz as subject
             from homework h join subjects sub on sub.id = h.subject_id
             where h.deleted_at is null and h.due_date >= current_date - 1 order by h.due_date`,
  teachers: `select t.*, sub.name_uz as subject from app.my_teachers() t left join subjects sub on sub.id = t.subject_id`,
  absenceReports: `select r.id, r.student_id, r.absence_date, r.reason, r.status from parent_absence_reports r
                   order by r.absence_date desc limit 10`,
  // leaders
  schoolId: `select school_id from app.my_schools() limit 1`,
  counts: `select (select count(*) from classes) as classes,
                  (select count(*) from teachers) as teachers,
                  (select count(*) from problems where status = 'open') as problems_open,
                  (select count(*) from parent_absence_reports where status = 'pending') as absence_pending,
                  (select count(distinct student_id) from gate_events
                    where direction = 'in' and scanned_at >= (current_date::timestamp at time zone 'Asia/Tashkent')) as arrived_today`,
  problems: `select p.id, p.category, p.severity, p.description, p.status, p.created_at from problems p
             where p.status <> 'handled' order by (p.severity = 'serious') desc, p.created_at desc limit 10`,
  classAttendance: `select c.grade_level || '-' || c.letter as class,
                      round(100.0 * count(*) filter (where a.status in ('present','late')) / nullif(count(*), 0), 1) as rate
                    from attendance_logs a join classes c on c.id = a.class_id
                    where a.date >= current_date - 30 group by c.grade_level, c.letter order by c.grade_level`,
};

async function home(user) {
  return asRole(user, async (q) => {
    const [me] = await q(Q.me);
    const schools = await q(Q.mySchools);
    const roles = schools[0]?.roles ?? [];
    const out = { me, school: schools[0] ?? null, roles };
    if (roles.includes("teacher")) out.day = (await q(Q.myDay))[0].day;
    if (roles.includes("parent") || roles.includes("student")) {
      Object.assign(out, {
        kids: await q(Q.kids), gateToday: await q(Q.gateToday), grades: await q(Q.grades),
        attendance: await q(Q.attendance30), homework: await q(Q.homework),
        teachers: await q(Q.teachers), absenceReports: await q(Q.absenceReports),
      });
    }
    if (roles.some((r) => ["director", "zavuch", "school_admin"].includes(r))) {
      const sid = (await q(Q.schoolId))[0]?.school_id;
      Object.assign(out, {
        stats: (await q("select * from app.school_stats($1)", [sid]))[0],
        counts: (await q(Q.counts))[0], problems: await q(Q.problems),
        classAttendance: await q(Q.classAttendance),
      });
    }
    return out;
  });
}

// ---- http ------------------------------------------------------------------
function send(res, code, body) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
async function readJson(req) {
  let s = "";
  for await (const ch of req) { s += ch; if (s.length > 1e5) throw new Error("too_large"); }
  return s ? JSON.parse(s) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const user = verify((req.headers.authorization || "").replace(/^Bearer /, ""));
  try {
    // public: school window branding for the login page
    let m = url.pathname.match(/^\/api\/window\/([a-z0-9-]{1,42})$/);
    if (m && req.method === "GET") {
      const rows = await asRole(null, (q) => q("select * from app.school_window($1)", [m[1]]));
      return rows.length ? send(res, 200, rows[0]) : send(res, 404, { error: "school_not_found" });
    }
    // public: one-tap login, DEMO school only
    if (url.pathname === "/api/login/demo" && req.method === "POST") {
      const { slug, role } = await readJson(req);
      if (!ROLES.includes(role)) return send(res, 400, { error: "bad_role" });
      const rows = await asRole(null, (q) => q("select * from app.demo_login_user($1, $2)", [slug, role]));
      if (!rows.length) return send(res, 403, { error: "demo_only" });
      const token = sign({ sub: rows[0].user_id, role, exp: Date.now() + SESSION_HOURS * 3600e3 });
      return send(res, 200, { token, user: rows[0] });
    }
    // logged in
    if (url.pathname === "/api/home" && req.method === "GET") {
      if (!user) return send(res, 401, { error: "login_required" });
      return send(res, 200, await home(user));
    }
    if (url.pathname === "/api/health") return send(res, 200, { ok: true });
    send(res, 404, { error: "not_found" });
  } catch (e) {
    // database permission errors are 403; never leak SQL details to the browser
    const code = e.code === "42501" ? 403 : 500;
    if (code === 500) console.error(e);
    send(res, code, { error: code === 403 ? "not_allowed" : "server_error" });
  }
});
server.listen(PORT, () => console.log(`Maktab+ API on :${PORT}`));
