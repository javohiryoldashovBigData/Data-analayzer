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
  myMessages: `select cr.id, cr.student_id, cr.topic, cr.body, cr.status, cr.reply, cr.created_at, cr.answered_at
               from contact_requests cr where cr.parent_user_id = auth.uid() order by cr.created_at desc limit 20`,
  // class teacher: parents' absence reports waiting for a decision
  absenceToReview: `select r.id, r.student_id, r.absence_date, r.reason, s.first_name, s.last_name,
                      c.grade_level || '-' || c.letter as class
                    from parent_absence_reports r join students s on s.id = r.student_id
                    join class_members cm on cm.student_id = s.id and cm.status = 'active'
                    join classes c on c.id = cm.class_id
                    where r.status = 'pending' and app.is_class_teacher_of(r.student_id)
                    order by r.absence_date`,
  forwardedToMe: `select cr.id, cr.topic, cr.body, cr.status, cr.created_at, s.first_name || ' ' || s.last_name as student
                  from contact_requests cr join students s on s.id = cr.student_id
                  where cr.forwarded_to = app.my_teacher_id() order by cr.created_at desc limit 10`,
  // leaders
  inbox: `select cr.id, cr.topic, cr.body, cr.status, cr.reply, cr.created_at, cr.forwarded_to,
                 s.first_name || ' ' || s.last_name as student, c.grade_level || '-' || c.letter as class,
                 p.first_name || ' ' || p.last_name as parent,
                 (select tp.first_name || ' ' || tp.last_name from teachers t join profiles tp on tp.user_id = t.user_id
                   where t.id = cr.about_teacher_id) as about_teacher
          from contact_requests cr join students s on s.id = cr.student_id
          left join class_members cm on cm.student_id = s.id and cm.status = 'active'
          left join classes c on c.id = cm.class_id
          left join profiles p on p.user_id = cr.parent_user_id
          order by (cr.status = 'open') desc, cr.created_at desc limit 20`,
  staffTeachers: `select t.id, p.first_name || ' ' || p.last_name as name from teachers t
                  join profiles p on p.user_id = t.user_id where t.status = 'active' order by p.last_name`,
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
    // money screens: director, school admin, accountant only (the database checks again)
    const out = { me, school, roles, role, seesMoney: ["director", "school_admin", "accountant"].includes(role) };
    if (role === "teacher") {
      out.day = (await q(Q.myDay))[0].day;
      out.absenceToReview = await q(Q.absenceToReview);
      out.forwarded = await q(Q.forwardedToMe);
      out.isClassTeacher = (await q("select exists (select 1 from classes where class_teacher_id = app.my_teacher_id()) as r"))[0].r;
      out.assignments = await q(`select ta.class_id, c.grade_level || '-' || c.letter as class, ta.subject_id, sub.name_uz as subject
                                 from teacher_assignments ta join classes c on c.id = ta.class_id join subjects sub on sub.id = ta.subject_id
                                 where ta.teacher_id = app.my_teacher_id() order by c.grade_level, sub.name_uz`);
    }
    if (role === "parent" || role === "student") {
      Object.assign(out, {
        kids: await q(Q.kids), gateToday: await q(Q.gateToday), grades: await q(Q.grades),
        attendance: await q(Q.attendance30), homework: await q(Q.homework),
        teachers: await q(Q.teachers), absenceReports: await q(Q.absenceReports),
        messages: role === "parent" ? await q(Q.myMessages) : [],
        reviews: (await q("select api.my_reviews() as r"))[0].r,
      });
    }
    if (LEADER.includes(role)) {
      const sid = school.school_id;
      Object.assign(out, {
        stats: (await q("select * from app.school_stats($1)", [sid]))[0],
        counts: (await q(Q.counts))[0], problems: await q(Q.problems),
        classAttendance: await q(Q.classAttendance),
        inbox: await q(Q.inbox), staffTeachers: await q(Q.staffTeachers),
        aiBudget: (await q("select api.ai_budget('lesson_prep') as r"))[0].r,
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

// ---- parents & students (step 3) ----------------------------------------------
const one = (rows) => rows[0] ?? null;
const family = {
  // parent reports an absence in advance (RLS: own child, not in the past)
  absence: (user, b) => {
    if (!UUID.test(b.student_id) || !DATE.test(b.date) || typeof b.reason !== "string" || b.reason.length > 500) throw bad("bad_request");
    return asRole(user, async (q) => one(await q(
      `insert into parent_absence_reports (school_id, student_id, parent_user_id, absence_date, reason)
       values (app.student_school($1), $1, auth.uid(), $2, $3) returning id, status`, [b.student_id, b.date, b.reason.trim()])));
  },
  // parent writes to the school office (never straight to a teacher)
  message: (user, b) => {
    if (!UUID.test(b.student_id) || typeof b.topic !== "string" || typeof b.body !== "string"
        || !b.topic.trim() || !b.body.trim() || b.topic.length > 120 || b.body.length > 2000
        || (b.about_teacher_id && !UUID.test(b.about_teacher_id))) throw bad("bad_request");
    return asRole(user, async (q) => one(await q(
      `insert into contact_requests (school_id, student_id, parent_user_id, about_teacher_id, topic, body)
       values (app.student_school($1), $1, auth.uid(), $2, $3, $4) returning id, status`,
      [b.student_id, b.about_teacher_id || null, b.topic.trim(), b.body.trim()])));
  },
  week: (user, classId, start) => {
    if (!UUID.test(classId) || !DATE.test(start)) throw bad("bad_request");
    return asRole(user, async (q) => (await q("select api.class_week($1::uuid, $2::date) as r", [classId, start]))[0].r);
  },
};
// class teacher decides on a parent's absence report (RLS: class teacher or leadership)
async function decideAbsence(user, b) {
  if (!UUID.test(b.id) || !["accepted", "rejected"].includes(b.status)) throw bad("bad_request");
  return asRole(user, async (q) => {
    const r = one(await q(`update parent_absence_reports set status = $2, reviewed_by = auth.uid(), reviewed_at = now(),
                             review_note = $3 where id = $1 and status = 'pending' returning id, status`,
                          [b.id, b.status, (b.note ?? "").slice(0, 500) || null]));
    if (!r) { const e = new Error("not_found_or_denied"); e.code = "42501"; throw e; }
    return r;
  });
}
// school office answers or forwards a parent's message (RLS: leadership of that school)
async function officeReply(user, b) {
  if (!UUID.test(b.id) || (b.forward_to && !UUID.test(b.forward_to))
      || (b.reply !== undefined && (typeof b.reply !== "string" || b.reply.length > 2000))) throw bad("bad_request");
  const status = b.forward_to ? "forwarded" : b.reply?.trim() ? "answered" : b.close ? "closed" : null;
  if (!status) throw bad("bad_request");
  return asRole(user, async (q) => {
    const r = one(await q(`update contact_requests set status = $2::contact_status, handled_by = auth.uid(),
                             forwarded_to = coalesce($3::uuid, forwarded_to), reply = coalesce($4, reply),
                             answered_at = case when $4 is not null then now() else answered_at end
                           where id = $1 returning id, status`, [b.id, status, b.forward_to || null, b.reply?.trim() || null]));
    if (!r) { const e = new Error("not_found_or_denied"); e.code = "42501"; throw e; }
    return r;
  });
}

// step 6 input checks: class + subject from the query; grade rows from the body
function sheetArgs(url) {
  const cls = url.searchParams.get("class") ?? "", subj = url.searchParams.get("subject") ?? "";
  if (!UUID.test(cls) || !/^\d{1,4}$/.test(subj)) throw bad("bad_request");
  return { cls, subj };
}
function gradeRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 60) throw bad("bad_request");
  return rows.map((r) => {
    if (!UUID.test(r?.student_id) || !Number.isInteger(r?.value)) throw bad("bad_request");
    return { student_id: r.student_id, value: r.value, note: String(r.note ?? "").slice(0, 500) };
  });
}

// ---- step 4: weekly tests, My class, zavuch check ------------------------------
const val = (user, sql, params) => asRole(user, async (q) => (await q(sql, params))[0]?.r ?? null);
const step4 = {
  // teacher
  "GET /api/teacher/tests": (u) => val(u, "select api.teacher_tests() as r"),
  "GET /api/teacher/myclass": (u) => val(u, "select api.my_class_overview() as r"),
  "GET /api/teacher/bank-topics": (u, b, url) => {
    const cls = url.searchParams.get("class") ?? "", subj = url.searchParams.get("subject") ?? "";
    if (!UUID.test(cls) || !/^\d+$/.test(subj)) throw bad("bad_request");
    return asRole(u, (q) => q(`select qb.topic, count(*)::int as questions from question_bank qb
                               where qb.subject_id = $2 and qb.status = 'checked'
                                 and qb.grade_level = (select grade_level from classes where id = $1)
                               group by qb.topic order by qb.topic`, [cls, subj]));
  },
  "POST /api/teacher/tests/generate": (u, b) => {
    if (!UUID.test(b.class_id) || !DATE.test(b.test_date) || typeof b.topic !== "string" || !b.topic.trim()) throw bad("bad_request");
    return val(u, "select api.generate_weekly_test($1::uuid, $2::smallint, $3, $4::date, $5, $6, $7, 'uz') as r",
      [b.class_id, b.subject_id, b.topic.trim(), b.test_date, Math.min(Math.max(+b.n_new || 8, 1), 20),
       Math.min(Math.max(+b.n_review || 0, 0), 10), b.mix !== false]);
  },
  "POST /api/teacher/tests/status": (u, b) => {
    if (!UUID.test(b.test_id) || !["published", "closed"].includes(b.status)) throw bad("bad_request");
    return asRole(u, async (q) => {
      const r = (await q("update weekly_tests set status = $2::test_status where id = $1 returning id, status", [b.test_id, b.status]))[0];
      if (!r) { const e = new Error("not_found_or_denied"); e.code = "42501"; throw e; }
      return r;
    });
  },
  "GET /api/teacher/tests/results": (u, b, url) => {
    const id = url.searchParams.get("test") ?? ""; if (!UUID.test(id)) throw bad("bad_request");
    return val(u, "select api.test_results($1::uuid) as r", [id]);
  },
  // student
  "GET /api/student/tests": (u) => val(u, "select api.my_tests() as r"),
  "POST /api/student/tests/start": (u, b) => { if (!UUID.test(b.test_id)) throw bad("bad_request"); return val(u, "select api.start_test($1::uuid) as r", [b.test_id]); },
  "POST /api/student/tests/answer": (u, b) => {
    if (!UUID.test(b.attempt_id) || !UUID.test(b.question_id) || !Number.isInteger(b.choice) || b.choice < 0 || b.choice > 5) throw bad("bad_request");
    return asRole(u, (q) => q("select api.save_answer($1::uuid, $2::uuid, $3)", [b.attempt_id, b.question_id, b.choice])).then(() => ({ ok: true }));
  },
  "POST /api/student/tests/submit": (u, b) => { if (!UUID.test(b.attempt_id)) throw bad("bad_request"); return val(u, "select app.submit_attempt($1::uuid) as r", [b.attempt_id]).then((score) => ({ score })); },
  // quarter + yearly grades (step 6) — the database decides who may do what
  "GET /api/grades/quarter": (u, b, url) => {
    const { cls, subj } = sheetArgs(url), term = url.searchParams.get("term");
    if (term && !UUID.test(term)) throw bad("bad_request");
    return val(u, "select api.quarter_sheet($1::uuid, $2::smallint, $3::uuid) as r", [cls, subj, term || null]);
  },
  "POST /api/grades/quarter": (u, b) => {
    if (!UUID.test(b.class_id) || !UUID.test(b.term_id) || !Number.isInteger(b.subject_id)) throw bad("bad_request");
    return val(u, "select api.save_quarter_grades($1::uuid, $2::smallint, $3::uuid, $4::jsonb) as r",
      [b.class_id, b.subject_id, b.term_id, JSON.stringify(gradeRows(b.rows))]);
  },
  "GET /api/grades/year": (u, b, url) => { const { cls, subj } = sheetArgs(url); return val(u, "select api.year_sheet($1::uuid, $2::smallint) as r", [cls, subj]); },
  "POST /api/grades/year/propose": (u, b) => {
    if (!UUID.test(b.class_id) || !Number.isInteger(b.subject_id)) throw bad("bad_request");
    return val(u, "select api.propose_final_grades($1::uuid, $2::smallint, $3::jsonb) as r", [b.class_id, b.subject_id, JSON.stringify(gradeRows(b.rows))]);
  },
  "GET /api/office/grades": (u) => val(u, "select api.grades_overview() as r"),
  "POST /api/office/grades/window": (u, b) => {
    if (typeof b.open !== "boolean") throw bad("bad_request");
    return val(u, "select api.set_final_window($1) as r", [b.open]);
  },
  "POST /api/office/grades/confirm": (u, b) => {
    if (!UUID.test(b.class_id) || !Number.isInteger(b.subject_id)) throw bad("bad_request");
    const changes = (Array.isArray(b.changes) ? b.changes : []).slice(0, 60).map((c) => ({
      student_id: String(c.student_id), value: Number(c.value), reason: String(c.reason ?? "").slice(0, 500) }));
    if (changes.some((c) => !UUID.test(c.student_id) || !Number.isInteger(c.value))) throw bad("bad_request");
    return val(u, "select api.confirm_final_grades($1::uuid, $2::smallint, $3::jsonb) as r", [b.class_id, b.subject_id, JSON.stringify(changes)]);
  },
  "GET /api/family/report": (u, b, url) => {
    const id = url.searchParams.get("student") ?? ""; if (!UUID.test(id)) throw bad("bad_request");
    return val(u, "select api.report_card($1::uuid) as r", [id]);
  },
  // money (step 7) — director, school admin, accountant; the database checks every call
  "GET /api/finance/overview": (u, b, url) => {
    const m = url.searchParams.get("month"); if (m && !DATE.test(m)) throw bad("bad_request");
    return val(u, "select api.finance_overview(coalesce($1::date, current_date)) as r", [m || null]);
  },
  "GET /api/finance/settings": (u) => val(u, "select api.fee_settings() as r"),
  "GET /api/finance/students": (u) => val(u, "select api.finance_students() as r"),
  "GET /api/finance/student": (u, b, url) => {
    const id = url.searchParams.get("id") ?? ""; if (!UUID.test(id)) throw bad("bad_request");
    return val(u, "select api.student_account($1::uuid) as r", [id]);
  },
  "POST /api/finance/rate": (u, b) => {
    if (!Number.isInteger(b.grade_level) || b.grade_level < 1 || b.grade_level > 11 || typeof b.amount !== "number") throw bad("bad_request");
    return asRole(u, (q) => q("select api.set_fee_rate($1::smallint, $2::numeric)", [b.grade_level, b.amount])).then(() => ({ ok: true }));
  },
  "POST /api/finance/discount": (u, b) => {
    if (!UUID.test(b.student_id) || !Number.isInteger(b.percent)) throw bad("bad_request");
    return asRole(u, (q) => q("select api.set_discount($1::uuid, $2::smallint, $3)", [b.student_id, b.percent, String(b.reason ?? "").slice(0, 300)])).then(() => ({ ok: true }));
  },
  "POST /api/finance/generate": (u, b) => {
    if (b.month && !DATE.test(b.month)) throw bad("bad_request");
    return val(u, "select api.generate_invoices(coalesce($1::date, current_date)) as r", [b.month || null]);
  },
  "POST /api/finance/pay": (u, b) => {
    if (!UUID.test(b.invoice_id) || typeof b.amount !== "number" || !["cash", "bank"].includes(b.method)) throw bad("bad_request");
    return val(u, "select api.record_payment($1::uuid, $2::numeric, $3, $4) as r", [b.invoice_id, b.amount, b.method, String(b.note ?? "").slice(0, 300)]);
  },
  "POST /api/finance/cancel-payment": (u, b) => {
    if (!UUID.test(b.payment_id)) throw bad("bad_request");
    return asRole(u, (q) => q("select api.cancel_payment($1::uuid, $2)", [b.payment_id, String(b.reason ?? "").slice(0, 300)])).then(() => ({ ok: true }));
  },
  "POST /api/finance/cancel-invoice": (u, b) => {
    if (!UUID.test(b.invoice_id)) throw bad("bad_request");
    return asRole(u, (q) => q("select api.cancel_invoice($1::uuid, $2)", [b.invoice_id, String(b.reason ?? "").slice(0, 300)])).then(() => ({ ok: true }));
  },
  "POST /api/finance/remind": (u) => val(u, "select api.send_fee_reminders() as r"),
  "GET /api/family/fees": (u) => val(u, "select api.my_fees() as r"),
  // AI (step 5)
  "POST /api/teacher/ai/prep": (u, b) => prepareWeek(u, b),
  "GET /api/ai/budget": (u) => val(u, "select api.ai_budget('lesson_prep') as r"),
  // leaders
  "GET /api/office/daycheck": (u, b, url) => {
    const d = url.searchParams.get("date") ?? ""; if (!DATE.test(d)) throw bad("bad_request");
    return val(u, "select api.school_day_check($1::date) as r", [d]);
  },
  "POST /api/office/problem": (u, b) => {
    if (!UUID.test(b.id) || !["handled", "escalated"].includes(b.status)) throw bad("bad_request");
    return asRole(u, async (q) => {
      const r = (await q(`update problems set status = $2::problem_status, resolution = coalesce($3, resolution),
                            assigned_to = coalesce(assigned_to, auth.uid()),
                            resolved_at = case when $2 = 'handled' then now() else resolved_at end
                          where id = $1 returning id, status`, [b.id, b.status, (b.note ?? "").slice(0, 1000) || null]))[0];
      if (!r) { const e = new Error("not_found_or_denied"); e.code = "42501"; throw e; }
      return r;
    });
  },
};

// ---- step 5: AI — "prepare next week" (Library first, then a budgeted AI job) --
// This server never calls the AI and never holds the API key. It decides the
// topics with our own code, uses checked Library cards for free, and RESERVES
// budget for the rest. The night worker (server/ai-worker.mjs) sends one Batch.
const MODEL_BY_PLAN = { standard: "claude-haiku-5-5", pro: "claude-sonnet-5-5" };
const EST_CENTS_PER_LESSON = 0.5;   // upper-bound estimate for one draft card (Haiku, batch)
async function prepareWeek(user, b) {
  if (!DATE.test(b.week_start)) throw bad("bad_request");
  return asRole(user, async (q) => {
    const ctx = (await q("select api.weekly_prep_context($1::date) as r", [b.week_start]))[0].r;
    const school = (await q("select school_id from app.my_schools() limit 1"))[0]?.school_id;
    // lessons already waiting in one of my AI jobs are not queued twice
    const queued = new Set((await q(`select jsonb_array_elements(payload->'lessons') as l from ai_reservations
                                     where status = 'pending' and feature = 'lesson_prep'`)).map((r) => `${r.l.class_id}|${r.l.date}|${r.l.period}`));
    const todo = ctx.lessons.filter((l) => !l.has_card && !queued.has(`${l.class_id}|${l.date}|${l.period}`));
    const out = { lessons: ctx.lessons.length, already_ready: ctx.lessons.length - todo.length, from_library: 0, ai_queued: 0, no_topic: 0 };
    const groups = new Map();
    for (const l of todo) { const k = `${l.class_id}|${l.subject_id}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
    const forAI = [];
    for (const [k, ls] of groups) {
      const [classId, subjectId] = k.split("|");
      const topics = await q("select topic, objectives from api.next_topics($1::uuid, $2::smallint, $3)", [classId, subjectId, ls.length]);
      const subject = (await q("select name_uz from subjects where id = $1", [subjectId]))[0]?.name_uz;
      for (const [n, l] of ls.entries()) {
        const tp = topics[n];
        if (!tp) { out.no_topic++; continue; }                         // no programme row: the teacher writes it
        const lib = (await q("select content from api.library_cards($1::smallint, $2::smallint, $3)", [subjectId, l.grade_level, tp.topic]))[0];
        if (lib?.content?.plan) {                                        // Library first: free
          const card = (await q("select api.open_lesson_card($1::uuid, $2::smallint, $3::date, $4::smallint) as r",
                                [classId, subjectId, l.date, l.period]))[0].r.card;
          await q("select api.save_lesson_card($1::uuid, $2::jsonb, false)", [card.id, JSON.stringify({
            topic: tp.topic, plan: lib.content.plan, homework: lib.content.homework ?? "", exit_questions: lib.content.exit_questions ?? [] })]);
          out.from_library++;
        } else {
          const gap = (ctx.gaps ?? []).filter((g) => g.class_id === classId && String(g.subject_id) === subjectId)
                        .map((g) => ({ topic: g.topic, mastered_pct: g.mastered_pct }));   // class-level numbers only
          forAI.push({ class_id: classId, subject_id: Number(subjectId), subject, grade: l.grade_level, date: l.date,
                       period: l.period, topic: tp.topic, objectives: tp.objectives ?? "", gaps: gap });
        }
      }
    }
    if (forAI.length) {
      const chk = (await q("select * from app.ai_check($1, 'lesson_prep')", [school]))[0];
      const model = MODEL_BY_PLAN[chk?.plan] ?? MODEL_BY_PLAN.standard;
      // savepoint: if the budget says no, the free Library cards above are KEPT
      await q("savepoint ai_res");
      try {
        await q("select app.ai_reserve($1, 'lesson_prep', $2, $3::jsonb)",
                [school, EST_CENTS_PER_LESSON * forAI.length, JSON.stringify({ kind: "prep", model, lessons: forAI })]);
        out.ai_queued = forAI.length;
      } catch (e) {
        await q("rollback to savepoint ai_res");
        if (e.code !== "P0001") throw e;                                // only budget/plan refusals
        out.ai_blocked = e.message;                                      // e.g. school_budget_reached
        out.ai_skipped = forAI.length;
      }
    }
    out.budget = (await q("select api.ai_budget('lesson_prep') as r"))[0].r;
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
    const s4 = step4[`${req.method} ${url.pathname}`];
    if (s4) {
      if (!user) return send(res, 401, { error: "login_required" });
      return send(res, 200, await s4(user, req.method === "POST" ? await readJson(req) : {}, url));
    }
    if (url.pathname.startsWith("/api/family/") || url.pathname === "/api/teacher/absence" || url.pathname === "/api/office/reply") {
      if (!user) return send(res, 401, { error: "login_required" });
      const p = url.pathname;
      if (p === "/api/family/week" && req.method === "GET")
        return send(res, 200, await family.week(user, url.searchParams.get("class") ?? "", url.searchParams.get("start") ?? ""));
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      const b = await readJson(req);
      if (p === "/api/family/absence") return send(res, 200, await family.absence(user, b));
      if (p === "/api/family/message") return send(res, 200, await family.message(user, b));
      if (p === "/api/teacher/absence") return send(res, 200, await decideAbsence(user, b));
      if (p === "/api/office/reply") return send(res, 200, await officeReply(user, b));
      return send(res, 404, { error: "not_found" });
    }
    if (url.pathname === "/api/health") return send(res, 200, { ok: true });
    send(res, 404, { error: "not_found" });
  } catch (e) {
    // database permission errors are 403; never leak SQL details to the browser
    // input / data errors → 400 with the function's own short code (e.g. no_term_for_date)
    if (e.code === "P0001" && ["school_budget_reached", "limit_reached", "plan_not_allowed"].includes(e.message))
      return send(res, 402, { error: e.message, hint: "try_library" });
    if (["22023", "22P02", "22007", "22008", "23502", "23514", "P0001"].includes(e.code))
      return send(res, 400, { error: /^[a-z_]+$/.test(e.message) ? e.message : "bad_request",
                              ...(UUID.test(e.detail ?? "") ? { student_id: e.detail } : {}) });   // which row needs a reason
    const code = e.code === "42501" ? 403 : 500;
    if (code === 500) console.error(e);
    send(res, code, { error: code === 403 ? "not_allowed" : "server_error" });
  }
});
server.listen(PORT, () => console.log(`Maktab+ API on :${PORT}`));
