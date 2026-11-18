# Maktab Plus: competitor brief and what to build to beat them

Prepared 18 November 2026 for Claude, who is building Maktab Plus with Javohir.

## How to use this document

Javohir has decided that Maktab Plus starts with private schools in Uzbekistan. This brief compares the three local products he wants to beat, lists every feature they advertise, and sets out what Maktab Plus should add or change as a result.

It is an addition to the existing plan (the v3 schema, the Phase 1 API and the 8-week build plan), not a replacement. Where this brief and the repository disagree about what is already built or decided, the repository is right: the "Maktab Plus status" column below comes from summaries of earlier rounds, so please correct it against the actual files.

Section 5 lists four places where this research conflicts with the current plan. Those need a decision from Javohir before you build them.

## 1. The three competitors

Everything here comes from each company's public marketing pages on 18 November 2026. The products themselves are behind demo requests and were not tested, and the customer numbers are the companies' own claims.

| | EduSchool | My School | iqbola |
|---|---|---|---|
| Site | https://eduschool.uz | https://my-school.uz | https://iqbola.uz |
| Main pitch | Broadest all-in-one platform for private schools, technical colleges and kindergartens | Finance first: income, debt and contracts in one dashboard | All-in-one, "and smarter": the only one that advertises AI |
| Claimed scale | 50+ schools, 15,000+ students | Not stated | 10+ pilot schools, 6,800+ students |
| Pricing | Not published; 7-day free trial | Published (see section 5.2) | Not published; free trial |
| Setup promise | 24–48 hours, free import from Excel | Four-step self-setup; free demo | 24 hours |
| Languages | Site in Uzbek, Russian and English | Uzbek | Parent app "in two languages" |
| Hosting claim | Not stated | Encryption and regular backups | Data on servers in Uzbekistan |

**EduSchool** is the strongest. It has the widest feature list, named integrations (Payme, Click, Atmos, Multicard, Eskiz.uz, PlayMobile, Hikvision, OnlinePBX, Moizvonki), four customer testimonials, and a parent app with chat and in-app payment.

**My School** is the simplest and the cheapest-looking. It is the only one that publishes prices, and it generates contracts automatically as PDFs.

**iqbola** is the newest and the closest to the Maktab Plus idea. Its AI is a risk dashboard that combines attendance, grade and payment signals and creates a task for the class teacher and psychologist. It also has an admissions funnel and homework in the journal.

## 2. Feature checklist

"Yes" means the feature is advertised on the homepage. A dash means it is not mentioned, which is not proof that it is missing.

| Feature | EduSchool | My School | iqbola | Maktab Plus status |
|---|---|---|---|---|
| Electronic journal, grades, attendance | Yes | Yes | Yes | In the 8-week plan |
| Timetable | Yes | Yes | — | In the 8-week plan |
| Homework | — | — | Yes | Check the repository |
| Term and periodic exams | Yes | — | Yes | Weekly tests are in the plan |
| Gate entry and exit with instant parent alert | Yes, face recognition | Yes | Yes, face recognition | Gate events are in the schema; device integration is new |
| Parent notifications | SMS and app | SMS and app | SMS and app | Telegram first, in the plan; SMS is new |
| Parent mobile app | Yes | Yes | Yes | New (Telegram covers it for now) |
| Teacher and student app | — | Yes | — | New |
| School–parent chat | Yes, moderated | — | — | New |
| Tuition payments by Payme and Click | Yes | — | Yes | Tables exist; build is planned after the pilot |
| Debt list with automatic reminders | Yes | Yes | Yes | New |
| Debt owner and agreed payment date per family | Yes | — | — | New |
| Contracts generated as PDF | — | Yes | — | New |
| Income, expenses, cash balance, profit and loss | Yes | Yes | Partly | New |
| Admissions funnel | Yes | Yes | Yes | Tables exist; build is planned after the pilot |
| Several branches | Yes | Yes | — | Check the repository |
| Roles and permissions | Custom role builder | — | Screens per role | Fixed roles enforced in the database |
| Ready-made reports with Excel export | 14+ | Yes | 30+ | Leader screens are in the plan; Excel export is new |
| Points, rewards shop, rankings | Yes | — | Yes | Not planned (see section 5.3) |
| Inventory and warehouse | Yes | — | — | Not planned; skip |
| AI risk alerts | — | — | Yes | New (see section 5.4) |
| AI lesson preparation for teachers | — | — | — | In the plan; nobody else has it |
| Spaced-repetition weekly tests | — | — | — | In the plan; nobody else has it |
| Excel import at onboarding | Yes, free | — | — | In the plan, weeks 1–2 |

## 3. Where all three are weak

1. **No AI assistant.** iqbola shows a risk list. None of them offers a helper that drafts work for a teacher or answers a director's question.
2. **Teachers and students are an afterthought.** All three sell to owners and accountants. Their pages are about debt, turnstiles and cash, not about saving a teacher's time or helping a child learn.
3. **No instant access.** Every site asks for a phone number and a call back before a school can see the product.
4. **Prices are hidden** on two of the three.
5. **Nothing about report-card periods, offline use, or who can change a grade and when.**

## 4. What to build

### 4.1 Match the basics private schools expect

A private school owner will compare Maktab Plus against the checklist in section 2. The pilot can run without finance, but a sale cannot, because all three competitors lead with money. After the pilot, the first additions should be:

- Tuition contracts per student, generated as a PDF from a template.
- A payment plan per contract, with Payme and Click payments recorded automatically.
- A debt list that is recalculated daily, with an automatic reminder to the parent and one named staff member responsible for each overdue family.
- Simple income and expense entry with a monthly summary. Full accounting can wait.
- Excel export on every report.
- SMS as a fallback for parents who do not use Telegram.

### 4.2 Make the Claude helper the headline, one job per role

This is the main difference from all three competitors. Each helper drafts, and a person approves, as already decided.

| Role | What the helper does | Status |
|---|---|---|
| Teacher | Prepares the week's lesson cards from the curriculum and the Library | In the plan |
| Teacher | Drafts report-card comments from the term's grades and attendance. Each comment is about the work and gives one next step, never a judgement of the child | New |
| Director and academic head | Answers plain-language questions such as "which classes fell below 90% attendance this month?" | New |
| Parent | A weekly summary of grades, attendance and upcoming work, sent by Telegram | New |
| Student | A study tutor that explains and sets practice but does not answer graded work | Planned after the pilot |

Two constraints carry over from earlier rounds. First, the helper must only ever see what the person asking is allowed to see, so every query runs under that user's own database permissions. Second, sending student data to the AI still needs the lawyer's sign-off. Until then:

- Build the director's helper so that Claude only chooses a predefined report and its filters. The app runs the report and shows the result, so no names or grades go to the model.
- Build the parent summary from a fixed template first. Add AI wording once the legal question is settled.

### 4.3 Be the product teachers prefer

- Keep the teacher's daily flow (my day, lesson card, after lesson, finished for today) as the centre of the product.
- Keep the offline-safe save after each lesson. eMaktab, the public-school platform, already lets teachers work without a connection, and none of the three private competitors mentions it.
- Keep report cards instant in the last week of term, using the summary table already designed. Say so on the website.

### 4.4 Let a school try it without a phone call

- A public demo school filled with sample data, with one-tap login as director, teacher or parent.
- Published prices.
- Keep "we import your Excel files for free", which EduSchool also offers.

### 4.5 Build trust in the open

- Host in Uzbekistan and say so. iqbola already advertises this.
- Lock grade edits after a fixed window and show the change history to school leaders. eMaktab locks edits after 72 hours under a ministry order, so private schools will recognise the rule.
- Publish a short, plain page on who can see a child's data.

### 4.6 Website

The site should show what the three competitors' sites do well: real product screens for each role, a short video, customer quotes once the pilot produces them, answered questions, and Uzbek, Russian and English versions. It should lead with the teacher's helper and the report-card speed, because the competitors lead with debt and turnstiles.

## 5. Conflicts with the current plan

### 5.1 Finance is scheduled too late for a private-school sale

The 8-week plan leaves payments and admissions until after the pilot. That is still right for the pilot itself. The risk is that the school's owner judges the product on debt control, which is the first thing every competitor shows. I recommend keeping the 8 weeks as they are and making the finance items in section 4.1 the first work after the dry run, ahead of the student tutor.

### 5.2 The price we planned to test is far above the one published price

Earlier rounds suggested testing about 15,000 so'm per student per month for Standard and 30,000 so'm for Pro. My School publishes flat yearly prices:

| My School plan | Students | Per year | Works out per student per month |
|---|---|---|---|
| START | Up to 200 | 6,000,000 so'm | 2,500 so'm at 200 students |
| PRO | 200–400 | 10,000,000 so'm | 2,083–4,167 so'm |
| BUSINESS | 400+ | 15,000,000 so'm | 3,125 so'm or less |

For a 300-student school billed for 12 months, Standard would cost 54 million so'm a year against My School's 10 million, which is 5.4 times as much. Pro would be 10.8 times as much. This is one competitor's price, and EduSchool and iqbola do not publish theirs, so the market level is still unknown. I recommend asking the pilot school what it pays now before fixing a price, and pricing the AI helper as the reason for any premium.

### 5.3 Do not copy the points-and-rankings feature as it is

EduSchool and iqbola both sell coins, a rewards shop and rankings. The research reviewed in an earlier round led to the rule "never show rankings", because ranking children against each other can lower performance. If schools ask for rewards, I recommend points for effort and attendance that only the child and parent can see, with no leaderboard.

### 5.4 Do not copy two things without a deliberate decision

- **Blocking a child at the turnstile because the parents owe money.** EduSchool advertises this. It leaves a child outside the building over an adult's debt, which is a safety risk and a reputational one. I recommend reminders and a named staff owner instead, and not building the block.
- **Mixing payment status into a child's risk label.** iqbola combines attendance, grades and debt into one indicator. I recommend showing attendance and grade signals to the class teacher, and keeping debt on the finance screens, so that teachers do not treat children differently because of what their parents owe. Start with simple rules (for example, attendance down two weeks running) before any prediction.

## 6. Suggested order after the 8-week pilot build

1. Contracts, payment plans, Payme and Click, debt list and reminders.
2. Report-card comment drafts and the director's question helper.
3. Public demo school, published prices and the three-language website.
4. Admissions funnel.
5. Gate device integration for the pilot school's hardware, and SMS fallback.
6. Excel export on reports, then the parent weekly summary.
7. Student tutor, once the legal check is done.

## 7. Decisions needed from Javohir

1. Is finance (section 4.1) the first work after the pilot, as recommended in 5.1?
2. What does the pilot school pay for its current system, and what price do we test?
3. Rewards without rankings, or no rewards feature at all?
4. Confirm that Maktab Plus will not block children at the gate over debt.
5. Is a parent mobile app needed in the first year, or is Telegram enough?

## Sources

- EduSchool homepage: https://eduschool.uz
- My School homepage, including prices: https://my-school.uz
- iqbola homepage: https://iqbola.uz
- eMaktab on the 72-hour grade-edit lock: https://emaktab.uz/news/418
- eMaktab on the offline teacher app: https://emaktab.uz/news/288
- Earlier Maktab Plus rounds (schema v3, Phase 1 API, pricing estimate, research review, 8-week plan): summarised from previous conversations, not re-read from the files.
