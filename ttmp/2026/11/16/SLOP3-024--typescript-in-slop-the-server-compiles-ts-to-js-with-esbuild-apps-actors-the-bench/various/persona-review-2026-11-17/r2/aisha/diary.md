## Step 0: Setting up
I'm Aisha, food bank volunteer coordinator. Starting a new app for shift sign-ups.
**Did:** benchdrive help / look
**Expected:** a bench screen
**Happened:** bench showing someone else's kanban app; I need my own.
**Felt:** fine, starting fresh.
## Step 1: Describing the app
Asked the agent in plain words for the shift sign-up app with all my rules (shifts, sign-up, waitlist, cancel, privacy).
**Did:** benchdrive aisha ask "...full description..."
**Expected:** an app with a coordinator view and volunteer view
**Happened:** agent built it as a proposal; canvas shows 'Coordinator view' with a code field and 'No shifts yet.'
**Felt:** hopeful — it read my privacy rule back to me in its plan.
## Step 2: Coordinator adds shifts
Logged in as coordinator (code foodbank) and added two shifts.
**Did:** typed date/time/task, clicked Add shift
**Expected:** shifts listed with spots filled
**Happened:** 'Pack boxes — Sat, Mar 14 · starts 9:00 AM — 0 of 2 spots filled' and second shift added.
**Felt:** this feels like my job, done.
## Step 3: Cancel button broken / agent flailing
I could not cancel as a volunteer: the cancel button has no visible label, and benchdrive could not click it. Asked the agent to fix it and prove cancel+waitlist works. The agent's turn ended twice with 'Nothing in the app changed in this turn' — it seems its evals errored out mid-investigation.
**Did:** asked agent; then 'Please continue...'
**Expected:** fixed button + proof of waitlist promotion
**Happened:** two turns with failed evals, no change.
**Felt:** frustrated — I'm stuck and losing time.
STRUGGLE: cancel button unusable; agent turn aborted twice without fixing it.
## Step 4: Cancel + waitlist promotion — works!
As volunteer, opened 'Cancel my sign-up' (a disclosure), entered Fatima/555-0101, clicked Cancel. Dev (waitlisted) moved in automatically: 'Volunteers: Rosa, Dev'.
**Did:** frame-click Cancel after typing Fatima's details
**Expected:** Fatima gone, Dev promoted
**Happened:** exactly that.
**Felt:** relieved — the rule I care about works. (STRUGGLE earlier: closed disclosure hid the cancel button and benchdrive couldn't see it; solved by clicking the summary first.)
## Step 5: First-name rule — works
Signed up 'Nadia Rahman' on Greet clients; volunteer view shows only 'Volunteers: Nadia'. Coordinator view shows 'Rosa · 555-0102 | Dev · 555-0103'.
**Did:** coordinator add full-name volunteer, then exited to volunteer view
**Expected:** only 'Nadia' visible to volunteers
**Happened:** exactly that.
**Felt:** good. Now I need hard proof phones never leave the server.
## Step 6: Edit + delete verified
Coordinator can now Edit (fixed Greet clients 2->3, 'Shift updated.') and Delete (confirm step 'Really delete?', shift gone).
**Did:** used Edit form and Delete button as coordinator
**Expected:** change spots count; delete scratch shift
**Happened:** both worked.
**Felt:** good — I can fix my own mistakes now.
## Step 7: Waitlist survives capacity raise
Filled Greet clients (needs 3), Tomas waitlisted. Raised needed to 4 as coordinator. Tomas moved in: '4 of 4 spots filled ... Tomas · 555-0112'.
**Did:** signed up 3 more, edited capacity
**Expected:** Tomas promoted, nobody lost
**Happened:** exactly that.
**Felt:** that was my biggest fear, and it held.

## Step 8: Verified new actions are guarded, published the app
Agent confirmed from the code that edit/delete actions demand the coordinator code every call. I clicked Publish in the header myself and accepted the dialog.
**Did:** asked for guard check; benchdrive aisha click Publish, Publish draft 12
**Expected:** app goes live for volunteers
**Happened:** "Published draft 12 to main", but no web address yet — an administrator must set the mount.
**Felt:** mostly done; mildly annoyed I need an admin for the address.

## Verdict
Did I get what I wanted? **Yes.** All four rules I asked for work and I tested each one by hand:
- I can add shifts (date, time, task, spots needed) and later edit or delete them (with a confirm).
- Volunteers sign up with name + phone; a full shift puts newcomers on a waitlist (Dev waited on Pack boxes).
- Cancelling promotes the first waitlisted person automatically (Fatima cancelled → Dev in). Raising capacity also promotes (Tomas moved in when I raised Greet clients to 4) — the waitlist never lost anyone.
- Privacy: volunteers see only first names (signed up as "Nadia Rahman", volunteers saw "Nadia"). The agent audited the code and answered plainly: phone numbers are only ever returned by the coordinator roster, which demands the code on every call; wrong code rejected in front of me; cancelling with a wrong phone was refused. I saw with my own eyes that the volunteer page shows no phones.

Hardest moment: the cancel form. The "Cancel my sign-up" section is a collapsed disclosure, the bench couldn't click its button while collapsed, and my first three attempts found nothing. Clicking the summary first solved it — but it cost me several tries and two aborted agent turns before I understood it.

Would I come back? Yes — I got further faster than I expected, and the agent explained things in plain words when I asked.

Three struggles that mattered most:
1. Cancel button invisible/unusable until I discovered the "Cancel my sign-up" disclosure had to be opened first.
2. The agent's turns kept ending mid-task ("Nothing in the app changed in this turn") several times — I had to keep saying "continue".
3. No way to prove phone-number privacy myself (I can't see what a browser receives); I had to trust the agent's code audit plus my visual check of the volunteer view.

Still open: the published app needs an administrator to give it a web address before my volunteers can use it.
