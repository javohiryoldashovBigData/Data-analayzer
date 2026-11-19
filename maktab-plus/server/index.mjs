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
const SESSION_HOURS = 12;
const LEADER = ["director", "zavuch", "school_admin"];

// ---- brute-force protection: 5 wrong passwords per login (or 20 per IP)
// within 10 minutes → that login/IP waits 1 minute. In memory for now; move to
// the database or Redis when we run more than one server.
const fails = new Map();
const WINDOW = 10 * 60e3, BLOCK = 60e3;
function blocked(key, limit) {
  const f = fails.get(key);
  return f && f.count >= limit && Date.now() - f.last < BLOCK;
}
function fail(key) {
  const f = fails.get(key);
  if (!f || Date.now() - f.first > WINDOW) fails.set(key, { count: 1, first: Date.now(), last: Date.now() });
  else { f.count++; f.last = Date.now(); }
}

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

// `wanted` = the role the person picked in the chooser. It only selects WHICH
// screen to build; it must be one of their real roles in this school (from the
// database), and RLS still filters every row.
async function home(user, wanted) {
  return asRole(user, async (q) => {
    const [me] = await q(Q.me);
    const schools = await q(Q.mySchools);
    const school = schools.find((x) => x.slug === user.school) ?? null;
    const roles = school?.roles ?? [];
    if (!roles.length) { const e = new Error("no_role"); e.code = "42501"; throw e; }
    const role = roles.includes(wanted) ? wanted : roles[0];
    const out = { me, school, roles, role };
    if (role === "teacher") out.day = (await q(Q.myDay))[0].day;
    if (role === "parent" || role === "student") {
      Object.assign(out, {
        kids: await q(Q.kids), gateToday: await q(Q.gateToday), grades: await q(Q.grades),
        attendance: await q(Q.attendance30), homework: await q(Q.homework),
        teachers: await q(Q.teachers), absenceReports: await q(Q.absenceReports),
      });
    }
    if (LEADER.includes(role)) {
      const sid = school.school_id;
      Object.assign(out, {
        stats: (await q("select * from app.school_stats($1)", [sid]))[0],
        counts: (await q(Q.counts))[0], problems: await q(Q.problems),
        classAttendance: await q(Q.classAttendance),
      });
    }
    return out;
  });
}

// ---- teacher's day (step 2): thin wrappers around the tested api.* functions.
// Each runs as the logged-in teacher; the functions + RLS check authority.
const UUID = /^[0-9a-f-]{36}$/i, DATE = /^\d{4}-\d{2}-\d{2}$/;
function bad(msg) { const e = new Error(msg); e.code = "22023"; return e; }
const teacher = {
  async open(user, b) {
    if (!UUID.test(b.class_id) || !DATE.test(b.date)) throw bad("bad_request");
    return asRole(user, async (q) => (await q(
      "select api.open_lesson_card($1::uuid, $2::smallint, $3::date, $4::smallint) as r",
      [b.class_id, b.subject_id, b.date, b.period]))[0].r);
  },
  async save(user, b) {
    if (!UUID.test(b.card_id)) throw bad("bad_request");
    return asRole(user, async (q) => (await q(
      "select api.save_lesson_card($1::uuid, $2::jsonb, $3::boolean) as r",
      [b.card_id, JSON.stringify(b.patch ?? {}), !!b.approve]))[0].r);
  },
  // everything the "after lesson" screen needs in one call
  async lesson(user, cardId) {
    if (!UUID.test(cardId)) throw bad("bad_request");
    return asRole(user, async (q) => {
      const [card] = await q(`select lc.id, lc.class_id, lc.subject_id, lc.lesson_date, lc.period, lc.topic, lc.plan,
                                     lc.homework, lc.status, lc.questions, c.grade_level || '-' || c.letter as class,
                                     sub.name_uz as subject
                              from lesson_cards lc join classes c on c.id = lc.class_id
                              join subjects sub on sub.id = lc.subject_id
                              where lc.id = $1 and lc.teacher_id = app.my_teacher_id()`, [cardId]);
      if (!card) { const e = new Error("card_not_found_or_denied"); e.code = "42501"; throw e; }
      const roster = await q(`select s.id, s.first_name, s.last_name,
                                (select a.status from attendance_logs a where a.student_id = s.id
                                  and a.date = $2 and a.period = $3) as status,
                                (select array_agg(g.value order by g.created_at) from grades g where g.student_id = s.id
                                  and g.subject_id = $4 and g.deleted_at is null
                                  and g.created_at >= $2::date and g.created_at < $2::date + 1) as grades_today,
                                exists (select 1 from gate_events ge where ge.student_id = s.id and ge.direction = 'in'
                                  and ge.scanned_at >= ($2::date::timestamp at time zone 'Asia/Tashkent')
                                  and ge.scanned_at <  ($2::date::timestamp at time zone 'Asia/Tashkent') + interval '1 day') as at_school
                              from class_members cm join students s on s.id = cm.student_id
                              where cm.class_id = $1 and cm.status = 'active'
                              order by s.last_name, s.first_name`, [card.class_id, card.lesson_date, card.period, card.subject_id]);
      const [exit] = await q("select questions, results, not_got, recorded_at from exit_checks where card_id = $1", [cardId]);
      const [report] = await q("select note, completed_at from lesson_reports where card_id = $1", [cardId]);
      const askFirst = (await q("select api.ask_first($1::uuid, $2::smallint, 3) as r", [card.class_id, card.subject_id]))[0].r;
      return { card, roster, exit: exit ?? null, report: report ?? null, askFirst };
    });
  },
  async finish(user, b) {
    if (!UUID.test(b.card_id) || !b.payload || !UUID.test(b.payload.client_op_id ?? "")) throw bad("bad_request");
    return asRole(user, async (q) => (await q("select api.finish_lesson($1::uuid, $2::jsonb) as r",
      [b.card_id, JSON.stringify(b.payload)]))[0].r);
  },
  async checklist(user, date) {
    if (!DATE.test(date)) throw bad("bad_request");
    return asRole(user, async (q) => (await q("select api.day_checklist($1::date) as r", [date]))[0].r);
  },
  async close(user, b) {
    if (!DATE.test(b.date)) throw bad("bad_request");
    return asRole(user, async (q) => (await q("select api.close_day($1::date) as r", [b.date]))[0].r);
  },
};

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
    // public: log in to ONE school window with login + password
    if (url.pathname === "/api/login" && req.method === "POST") {
      const { slug, login, password } = await readJson(req);
      if (typeof slug !== "string" || typeof login !== "string" || typeof password !== "string"
          || !login.trim() || !password || password.length > 200) return send(res, 400, { error: "bad_request" });
      const ip = req.socket.remoteAddress ?? "?";
      const key = `${slug}|${login.replace(/[^0-9a-z.+]/gi, "").toLowerCase()}`;
      if (blocked(key, 5) || blocked(ip, 20)) return send(res, 429, { error: "too_many_attempts" });
      const rows = await asRole(null, (q) => q("select * from app.password_login($1, $2, $3)", [slug, login, password]));
      if (!rows.length) { fail(key); fail(ip); return send(res, 401, { error: "bad_credentials" }); }
      fails.delete(key);
      const u = rows[0];
      const token = sign({ sub: u.user_id, school: slug.toLowerCase(), exp: Date.now() + SESSION_HOURS * 3600e3 });
      return send(res, 200, { token, user: { first_name: u.first_name, last_name: u.last_name }, roles: u.roles });
    }
    // logged in
    if (url.pathname === "/api/home" && req.method === "GET") {
      if (!user) return send(res, 401, { error: "login_required" });
      return send(res, 200, await home(user, url.searchParams.get("role")));
    }
    // teacher's day
    m = url.pathname.match(/^\/api\/teacher\/(open|save|finish|close|checklist|lesson)$/);
    if (m) {
      if (!user) return send(res, 401, { error: "login_required" });
      const op = m[1];
      if (op === "lesson" && req.method === "GET") return send(res, 200, await teacher.lesson(user, url.searchParams.get("card") ?? ""));
      if (op === "checklist" && req.method === "GET") return send(res, 200, await teacher.checklist(user, url.searchParams.get("date") ?? ""));
      if (req.method === "POST" && ["open", "save", "finish", "close"].includes(op)) return send(res, 200, await teacher[op](user, await readJson(req)));
      return send(res, 405, { error: "method_not_allowed" });
    }
    if (url.pathname === "/api/health") return send(res, 200, { ok: true });
    send(res, 404, { error: "not_found" });
  } catch (e) {
    // database permission errors are 403; never leak SQL details to the browser
    // input / data errors → 400 with the function's own short code (e.g. no_term_for_date)
    if (["22023", "22P02", "22007", "22008", "23502", "23514", "P0001"].includes(e.code))
      return send(res, 400, { error: /^[a-z_]+$/.test(e.message) ? e.message : "bad_request" });
    const code = e.code === "42501" ? 403 : 500;
    if (code === 500) console.error(e);
    send(res, code, { error: code === 403 ? "not_allowed" : "server_error" });
  }
});
server.listen(PORT, () => console.log(`Maktab+ API on :${PORT}`));
