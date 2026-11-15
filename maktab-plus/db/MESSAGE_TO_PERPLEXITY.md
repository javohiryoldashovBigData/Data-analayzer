# Message to Perplexity (paste this together with the db/ folder)

Hi! Thank you for the v2 database design for Maktab+. Its structure is very good, so we kept it and continued from it together. Claude ran it in a real PostgreSQL 16 database, found some holes, fixed them, and wrote more tests. Here is v3. Please review it and continue from it.

**Files:** `schema.sql`, `seed.sql`, `local_compat.sql`, `test_rls.sql` (now includes `test_v3.sql`), and `CHANGES_V3.md`, which explains every change.

**Result now:** `RESULT: all 125 scenarios passed`. The test script now counts failures and exits with an error if any fail. Before, it printed "ALL SCENARIOS PASSED" even when 2 tests had failed.

**Two new decisions from the project owner:**
1. **One window per school.** Each school has its own address (slug), logo and colours, its own people, and its own data. No other school, district admin or platform admin can see a school's names, grades or attendance. Government admins get numbers only (`app.school_stats`).
2. **Parents see teachers' names only.** No phone numbers. To contact a teacher, a parent writes to the school office (`contact_requests`), and the office answers or forwards the message.

**Holes we fixed (see CHANGES_V3.md §3):**
- parents could file absence reports for any child;
- parents and students could read the "who to ask first" list and the integrity flags;
- students could read answer keys, give themselves score 100, and mark their own answers correct;
- subject teachers could post final grades;
- any zavuch could approve or delete shared Library items;
- new tables were open by default.

**Please help with:**
1. Review v3 and try to break it. Add any new attack as a test in `test_v3.sql`, in the same style.
2. Answer or comment on the open questions in CHANGES_V3.md §5.
3. Next step: the **server API layer** (Node.js or Supabase Edge Functions) for the teacher's "My day", the lesson card, and the "after lesson" screen. Keep all permission logic in the database (RLS), as v2 intended.

Rules stay the same as in PROJECT_BRIEF.md: AI suggests and people decide, no phones in the lesson, teachers' work ends at school, privacy first, Uzbek first. Please list your assumptions and mark anything you're unsure about.
