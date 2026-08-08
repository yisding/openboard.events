# Openboard judge walkthrough

Demo credentials: `maya@ai.engineer` / `openboard-demo`. Portal identity: Nadia Rahman. OTP code: `424242`.

1. Open `/events`, choose **AI Engineer World’s Fair 2026**, and review the dashboard.
2. Open **Forms**, create a form, add a question, configure conditional visibility, and publish. The seeded Technical Talks form shows the structural lock after receiving submissions.
3. Open `/submit/ai-engineer/technical-talks`. Submit a proposal using any email and OTP `424242`. Choose **Yes** for the live-demo question to reveal its conditional follow-up.
4. In **Abstracts**, open the new proposal, inspect **Answers**, score it in **Evaluation**, move it to the accept queue, accept it, and click **Notify accepted speakers**.
5. In **Speakers**, open Nadia and choose **Open portal as Nadia**. Update the profile, upload a file to the slides task, and complete the remaining task.
6. In **Agenda**, open the unscheduled session, assign a time and room, and verify the conflict indicator. Check Day, List, Track, Room, and Conflicts views.
7. Open `/e/ai-engineer/schedule` and `/e/ai-engineer/speakers`; confirm only published sessions and confirmed speakers appear. Open **Embeds** and copy either iframe.
8. In **Communications**, inspect the log, edit a sanitized template, and send a reminder. Download `/cal/demo` to inspect the speaker calendar feed.

Demo changes persist in this browser. Use **Reset demo** on `/events` to restore the seed.
