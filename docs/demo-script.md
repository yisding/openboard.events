# Openboard judge walkthrough

This script has **two worlds**, and every step below says which it walks:

- **Browser demo** — open `/` with no credentials configured and choose **Open demo**. Data
  lives in localStorage; the OTP is fixed at `424242`; **Reset demo** on `/events` restores the
  seed. Demo credentials: `maya@ai.engineer` / `openboard-demo`. Portal identity: Nadia Rahman.
- **Deployed preview** — the real database-backed path. OTPs are real emails (the preview sends
  from the verified domain behind an allowlist); `424242` is rejected; form URLs use the real
  form UUID (`/submit/<eventSlug>/<form UUID>` — a slug like `technical-talks` 404s). The
  admin forms list is not yet database-backed, so the supported source for that UUID is the
  seed run's output: `pnpm seed` prints `public CFP path: /submit/<eventSlug>/<uuid>` for the
  open form. Calendar feeds require a real signed token from a portal invite
  (`/cal/<token>` — `/cal/demo` is not a valid token).

Steps (world noted per step; the deployed column tracks `plan/status.md` and moves as modules
land):

1. *(both)* Open `/events`, choose **AI Engineer World's Fair 2026**, and review the dashboard —
   database-backed on the deployed preview.
2. *(browser demo)* Open **Forms**, create a form, add a question, configure conditional
   visibility, and publish. The seeded Technical Talks form shows the structural lock. *(The
   deployed builder does not yet write to the database — M12.)*
3. *(both — the deployed path is proven end-to-end)* Open the CFP link and submit a proposal.
   Browser demo: any email + OTP `424242`. Deployed: a real emailed OTP, server draft, and
   server submit. Choose **Yes** for the live-demo question to reveal its conditional follow-up.
4. *(browser demo for the full loop)* In **Abstracts**, open the new proposal, inspect
   **Answers**, score it in **Evaluation**, accept it, and click **Notify accepted speakers**.
   *(Deployed: the abstracts table reads the database; the decide/notify server routes are
   merged (#57) but have no UI yet, and Evaluation is not yet server-backed.)*
5. *(browser demo)* In **Speakers**, open Nadia and choose **Open portal as Nadia**. Update the
   profile, upload a file to the slides task, and complete the remaining task. *(Deployed:
   portal home/submissions are real; profile, tasks, and uploads are not yet wired.)*
6. *(browser demo)* In **Agenda**, open the unscheduled session, assign a time and room, and
   verify the conflict indicator.
7. *(both)* Open `/e/<eventSlug>/schedule` and `/e/<eventSlug>/speakers`; the deployed pages are
   edge-cached and embeddable. Open **Embeds** and copy either iframe. *(Deployed page content
   still renders demo fixtures pending M32's rewrite onto the published views.)*
8. *(browser demo)* In **Communications**, inspect the log, edit a sanitized template, and send
   a reminder. *(Deployed: the dispatcher and delivery are proven; the comms admin UI is not yet
   wired to the real log. Calendar feeds live at `/cal/<token>` from a real invite.)*

Browser-demo changes persist in that browser only; **Reset demo** on `/events` restores the
seed.
