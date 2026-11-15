# Maktab+ database: v3 (Perplexity v2 + Claude)

v2 was designed by Perplexity. v3 keeps its structure and fixes what joint testing found. It also adds two decisions from the project owner: **one window per school**, and **parents see teachers' names only**.

## How to run

```
psql -v ON_ERROR_STOP=1 -f local_compat.sql -f schema.sql -f seed.sql   # (skip local_compat on Supabase)
psql -v ON_ERROR_STOP=1 -f test_rls.sql                                  # includes test_v3.sql
```

The last line printed is `RESULT: all 125 scenarios passed`. If any scenario fails, every failure is listed and the script exits with an error. (v2 printed "ALL SCENARIOS PASSED" even when tests had failed.)

## 1. One window per school

| What | How |
|---|---|
| Own address | `schools.slug` gives `school-a.maktabplus.uz` |
| Own look | `logo_url` and `brand_color`; the login page reads them through `app.school_window(slug)`, which returns branding only |
| Own people and data | Only people with a role **inside** the school pass `member_at` / `manages_school` |
| Not visible to other schools | Users see only their own school in `schools` (v2: every school was visible to everyone) |
| District, region and super admins | They are **not** inside any school, so they see no names, grades or attendance. They get **numbers only** from `app.school_stats()`: always for government schools, and for private schools only if the school opts in (`share_stats_with_government`, check with a lawyer) |
| Closing a window | `schools.is_active = false`: nobody can get in (e.g. an unpaid subscription) |
| School picker | `app.my_schools()` |
| Who changes settings and roles | School admin and director only. A zavuch can no longer make anyone, including themselves, an admin |

## 2. Parents and teachers

- Parents and students **cannot** read teachers' profiles (no phone numbers).
- `app.my_teachers()` gives them the teachers' **first and last names** only (subject, class teacher).
- To reach a teacher, a parent writes to the **school office** (new table `contact_requests`). The admin, director or zavuch answers it or forwards it to the teacher. The office gets an alert.
- Teachers no longer see parents' phone numbers either. Contact goes through the office in both directions.

## 3. The 10 holes in v2, now fixed (each has a test)

| # | Hole | Fix |
|---|---|---|
| A1 | Parent could file an absence report for any child (`g.student_id = student_id` compared the column with itself) | Fully qualified; the school must be the child's school; no past dates; must start `pending` |
| A2 | Parents and students could read lesson cards, including the "who to ask first" list | Only the card's teacher, the substitute for that lesson, and leadership can read them |
| A3 | Parents and students could see integrity flags | Teacher of the test and leadership only; the teacher records a `decision` |
| A4 | Students could read the answer key | Keys moved to `test_answer_keys`; students see them only after the test is `closed` |
| A5 | Student could create an attempt with score 100 | Students start only empty attempts on published tests of their own class; score is set by the server |
| A6 | Student could mark own answer correct | Students cannot set `is_correct`; `app.submit_attempt()` scores on the server; answers lock after submitting |
| A8 | Subject teacher could post a final grade | Teachers post current, exam and quarter grades; **final grades are confirmed by zavuch or director** (assumption: easy to change). A class teacher can't grade subjects they don't teach |
| A9 | Any zavuch could mark any Library item "checked" | Only a **methodologist** (new role) can |
| A10 | Any zavuch could delete shared Library items | Only the author (while unchecked) or a methodologist can |
| A11 | New tables were open to everyone by default | Default grant removed; a test fails if any table has RLS off |

## 4. Smaller fixes

- All security-definer trigger functions now pin `search_path` (a test checks this).
- Audit rows without a school are no longer visible to everyone.
- Class rosters, homework, class announcements, tests and substitutions are visible only to the right class or to staff, not to the whole school.
- Rows that name a class (lesson cards, tests, announcements) must also name that class's school.
- An attendance update re-checks the same authority as an insert.
- Anonymous visitors can call only `app.school_window()`.

## 5. Open questions (for the team)

1. Final grades: should zavuch confirm them (current setting), or should teachers post them?
2. Should private schools share numbers with the government by default? Check with a lawyer.
3. A teacher working in two schools: `teachers.user_id` is still unique (v2 assumption).
4. Methodologists are platform staff with no school. Is that right, or should schools have their own?
