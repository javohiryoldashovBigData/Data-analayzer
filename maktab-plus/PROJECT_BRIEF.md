# Maktab+ — Project Brief (v2, for our team: Javohir + Claude + Perplexity)

*Paste this whole document into Perplexity together with the `maktab-plus/db/` folder. We work as one team: each of us finds problems, fixes them and checks the other's work. Nothing is accepted until it is tested.*

## 1. The goal in one paragraph

Maktab+ is a school platform for Uzbekistan: an electronic diary and gradebook like Kundalik, but faster, more flexible, with **teaching methods from the world's top school systems built in**, and AI where it truly helps. Its main promises are: **parents always know whether their child is at school**, **teachers finish their work at school instead of at home**, and **students learn with proven methods**. We start with **private schools** (fast decisions, they pay), then serve government schools from the same platform.

## 2. Rules every design must follow

1. **AI suggests, people decide.** AI never gives a final grade or punishes anyone on its own.
2. **No phones in the lesson.** Students don't use phones in class. The teacher uses a tablet or phone as little as possible.
3. **Work ends when school ends.** Every teacher feature must save time, not add work.
4. **Privacy first.** Each person sees only what they are allowed to see. No GPS, only school entry and exit. Data of Uzbek citizens is stored in Uzbekistan (check with a lawyer).
5. **Simple.** Uzbek (Latin) first, also Russian and English. Big buttons, few steps.
6. **One window per school.** Each school has its own address, look, people and data. No other school can see its window. *(new)*
7. **AI costs stay low.** Use our own code first, the Library second and AI third. *(new)*

## 3. Roles

| Role | What they do |
|---|---|
| **Teacher** | "My day" screen; one-page lesson card per lesson (plan, who to ask first, questions, homework); weekly lesson preparation; 1–2 minute "after lesson" screen; weekly tests; "Finished for today" checklist; quiet hours after 18:00 |
| **Zavuch** | Checks daily that grades, topics, homework and plans are entered; problem inbox (serious problems go to the director); timetable and substitutions; approves lesson plans; **confirms final (yearly) grades**; shares the best lesson cards (Lesson Study) |
| **Director / school admin** | Escalated problems and key numbers; staff, roles, school settings, logo and colours; payments (private schools) |
| **Student** | Diary, grades, homework, weekly tests, Library; AI tutor in Pro only |
| **Parent** | Live alerts (arrived, late, left, skipped a lesson); reports an absence in advance; grades and diary; fee payments (private); sees teachers' **names only** and contacts teachers **through the school office** |
| **Methodologist** | Platform-level expert who checks Library items before they become "checked" |
| **Government** (later) | Numbers only, never names. Private schools share numbers only if they agree |

## 4. Key features

- **Shared attendance:** QR/NFC at the school gate; instant parent alert; "skipped lesson" alert when the student is in the building but absent from a lesson; absence reports in advance.
- **Who to ask first:** a private list for the teacher only, made by our own code (missing homework, falling grades, missed lessons, weak weekly test, not asked for a long time).
- **Weekly tests:** different question and option order per student; the answer key is hidden and scoring happens on the server; independent-work signals (similar answers, big level jump, very fast answers, pasted text, leaving the window) go to the teacher only, and the teacher decides.
- **The Library (core idea):** made once, checked by a methodologist, used by everyone: 1-minute animations, Photo → Board (exact graphs on the projector), Photo → Learn, lesson cards, worksheets, tests. AI-made items are labelled "AI-made, not yet checked".
- **Maktab+ Yordamchi:** one helper box. Rule: **Library first, AI second.**
- **Parent → school office messages:** the office answers or forwards to the teacher.

## 5. Methods from the world's top school systems (our main selling point)

Pitch: "methods used by top school systems, built into Maktab+". **Never promise their results**; after the pilot we show our own numbers.

| Method | Source | In Maktab+ |
|---|---|---|
| **Formative assessment** | Finland, UK (Dylan Wiliam) | A 3-question "exit check" at the end of the lesson (show of hands, or on the teacher's tablet); feeds "who to ask first" |
| **Mastery learning** | Singapore, Bloom | Weekly tests show topics the class hasn't mastered; the next lesson card suggests a 10-minute review |
| **Spaced repetition / retrieval practice** | Cognitive-science research | Each weekly test adds 1–2 questions from older topics |
| **Feedback, not only grades** | Research on feedback | A short "what to improve" comment with grades; weekly summary for parents |
| Concrete → Pictorial → Abstract | Singapore Math | Library animations follow these 3 steps |
| Lesson Study | Japan | Teachers rate and reuse each other's lesson cards; the best go to the Library |
| Less, better homework | Finland | Homework time limit on the lesson card; director sees daily homework load |
| Project-based learning | IB / Cambridge | Optional project weeks (later) |

**Pilot uses the first 4** (bold) so teachers are not overloaded. Please check the research behind each and mark anything uncertain.

## 6. Plans: Standard and Pro

| | **Standard** | **Pro** |
|---|---|---|
| AI for | **Teachers only** (plus a small amount for the zavuch) | Teachers, zavuch, director, students, parents |
| Teacher AI | Lesson preparation, lesson cards, weekly test creation, Photo → Board, all with monthly limits | Same with higher limits, **plus AI exam checking** from photos |
| Students | No AI: Library, weekly tests, results | AI tutor at home (explains, never hands over answers), Photo → Learn |
| Parents | No AI: live alerts, grades, simple weekly summary made by our own code | Weekly AI report |
| Director | Numbers and charts from our own code | Monthly AI report |
| Price | Lower | Higher |

- **Most "smart" features are our own code and free**, so Standard still feels smart for everyone: who to ask first, risk alerts, copy signals, forecasts, attendance alerts, charts, the Library.
- **Pilot:** the first school gets Standard plus a **free 1–2 month Pro trial**. We measure real usage and cost, then set prices.
- **Later:** add-ons (e.g. exam checking only) for Standard schools.
- **Already in the database (v3):** `schools.plan`, `schools.pro_trial_until`, `ai_plan_rules` (which role gets which AI feature in which plan, with a monthly limit), and `app.ai_check(school, feature)`. The server calls it before every AI request and logs usage after. The limits are **placeholder estimates** until the pilot.

### Ways to keep AI cost low
1. **Our own code first, Library second, AI third.**
2. **Cheap models for simple jobs**, strong models only for hard jobs (e.g. reading exam photos).
3. **Monthly limit per person.** When it's reached: "Limit reached, try the Library".
4. **Batch work:** weekly lesson preparation runs once a week, not on every click.
5. **Prompt caching** for the parts that repeat (curriculum, instructions).
6. **Send the AI only what's needed,** without names ("Student A").
7. **Good AI results go to the Library** after review, so the next teacher gets them free.

Rough estimate before these savings: about $300–650 per month for 10 schools with AI for everyone. Standard (teachers only) should cost much less. **Estimate only; measure in the pilot.**

## 7. Technology

React + TypeScript web app (installable PWA, mobile apps later); self-hosted Supabase/PostgreSQL **in Uzbekistan**; all permission rules in the database (row-level security); AI (Claude via the API) called **only from our server**; Telegram bot, SMS and push for alerts; Click/Payme; QR/NFC scanner app on a tablet at the gate; offline-first attendance.

## 8. Current state

- **Prototype (Phase 0):** a working React demo with sample data covering 4 roles, gradebook, diary, live attendance and gate simulation, skipped-lesson alerts, absence reports, who to ask first, AI exam checking, lesson studio, chemistry lab, weekly tests, assistant, 3 languages, dark mode, phone layout.
- **Database v3** (`db/`): Perplexity's v2 structure plus joint fixes. **133 test scenarios, all passing**, on PostgreSQL 16. See `db/CHANGES_V3.md`:
  - one window per school;
  - parents see teachers' names only;
  - 10 security holes fixed;
  - Standard/Pro AI plans;
  - honest test runner that fails loudly.

  How to run:
  ```
  psql -v ON_ERROR_STOP=1 -f local_compat.sql -f schema.sql -f seed.sql
  psql -v ON_ERROR_STOP=1 -f test_rls.sql      # ends with "RESULT: all 133 scenarios passed"
  ```

## 9. Decisions made (please keep them)

1. Parents see teachers' **names only**; contact goes through the school office.
2. **One window per school**; government sees numbers only; the platform super admin can't read children's data.
3. **Final grades** are confirmed by the zavuch or director; teachers enter current, exam and quarter grades.
4. **Standard** = AI for teaching only; **Pro** = AI for everyone; the pilot gets a Pro trial.
5. Pilot methods: formative assessment, mastery learning, spaced repetition, feedback comments.

## 10. Open questions

1. Should methodologists be platform staff (current) or does each school have its own?
2. A teacher working in two schools: currently one school per teacher.
3. Must private schools share numbers with the government? (lawyer)
4. Real AI limits per plan: measure in the pilot.

## 11. What we need from you, Perplexity

1. **Review database v3 and try to break it.** Add every new attack as a test in `db/test_v3.sql`, in the same style. Tell us what you changed and why.
2. **Check section 5:** is the research behind each method solid? What would you add or remove? Mark anything uncertain.
3. **Check section 6:** are the plan split, the cost-saving ideas and the placeholder limits sensible? Suggest a simple pricing model for Uzbek private schools (per student per month?), and label estimates as estimates.
4. **Next build step:** design the server API (Supabase Edge Functions or Node.js) for **Phase 1, the teacher's day**:
   - "My day";
   - the lesson card with the exit check;
   - the "after lesson" screen;
   - "Finished for today";
   - weekly lesson preparation, calling `app.ai_check` before AI.

   All permission logic stays in the database.

When you answer: list your assumptions, mark anything you are unsure about, and do not invent laws or statistics. Say "check with a lawyer" or "estimate" where needed.
