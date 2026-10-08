# Maktab+

A school platform for Uzbekistan: e-diary, gradebook, live attendance shared with parents, and AI helpers for teachers and students. This folder is **Phase 0, the interactive prototype**. It runs entirely in the browser on sample school data.

## Run it

```bash
cd maktab-plus
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ (works from any folder or static host)
```

Interface languages: Uzbek (default), Russian and English. Light and dark themes. Works on phones.

## Roles and features

| Role | What they can do |
|---|---|
| **Parent** | Live status (arrived, late, left school), alerts when a child skips a lesson while in the building, report an absence in advance (full or part day), choose alert channels (app, Telegram, SMS), multi-child switcher, diary, grades, AI report |
| **Teacher** | Gradebook (topics, homework, CSV export), lesson attendance next to gate-scan data, **who to ask first**, **AI exam checking** (answer sheet photos → suggested points and grade, teacher approves), **AI lesson studio** (plan, virtual experiment, video storyboard, real-experiment guide with safety rules, quiz, slides), **weekly tests** with independent-work checks, AI watchlist, letters to parents |
| **Student** | Diary, grades with AI forecast, weekly tests (own question and option order, follow-up "explain your answer" question), virtual chemistry lab, AI tutor |
| **Director** | School dashboard, attendance by class, **entrance scanner** (QR/NFC simulation, simulate the morning, notify parents of missing students), at-risk students, test reviews |

### Independent-work check (weekly tests)
Signals: nearly identical written answers, identical wrong choices, a result far above the student's usual level, implausibly fast answers, pasted text, leaving the test window, and a weak answer to the AI follow-up question. Results are **flags for the teacher, never automatic penalties**. Flagged results get no grade until the teacher decides.

### Who to ask first
Ranks students by: missing homework, low recent grades, falling trend, missing the previous lesson, a weak weekly-test result. A second list shows students not asked for a long time, to keep the rotation fair. Only the teacher sees these lists.

## AI

Analytics, the readiness list, risk checks, independence checks, offline exam checking and the virtual lab all **work without an AI key**.

For generative features (reading photos of answer sheets, tutor chat, lesson plans, video storyboards, AI-written weekly tests), add an Anthropic API key in **Settings**. The app uses `claude-opus-5-5` via the official `@anthropic-ai/sdk`, with server-side refusal fallback (`fallbacks: "default"`).

> ⚠️ Prototype only: the key is stored in the browser and calls go directly from it. In Phase 1 these calls move to the Maktab+ backend so the key is never exposed.

## Demo walkthrough

1. **Director** → *Entrance scanner* → type `MK-1001` (Sardor) → Enter. Turn off "Use real time" first and pick 08:12 to see a late arrival.
2. **Parent** (Dilshod Rahimov) → the dashboard shows the live status and the Telegram-style alert. Switch between the two children at the top.
3. **Teacher** (Aziza Karimova, homeroom 8-A) → *Weekly tests* → the 8-A Chemistry test shows the planted cases: Jasur copied from Madina, Otabek's sudden 100% in seconds, Nilufar pasting text.
4. **Teacher** → *AI exam checking* → *Load sample answers* → *Check with AI* → adjust anything → *Approve and save*.
5. **Student** (Sardor) → *Weekly tests* → take the maths test → answer the follow-up question.
6. *Settings* → *Reset demo* restores the sample data at any time.

## Structure

```
src/
  data/       types, sample school (seed), question bank
  ai/         insights.ts (local analytics), claude.ts (Claude API), context.ts (role-scoped data for the AI)
  lib/        store (state + actions + notifications), i18n + dictionary, dates, queries
  components/ UI kit, charts, AI box, chemistry lab
  pages/      one file per screen
```

## Next (Phase 1)
Real backend (NestJS + PostgreSQL) hosted in Uzbekistan, OneID login, a Telegram bot and SMS gateway for alerts, a real QR/NFC scanner app for the gate tablet, AI calls through the server, and a pilot school.
