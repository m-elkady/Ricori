# Handover

This was five bug reports that turned out to be five separate root causes, two of them sharing a piece with another. For each one below I'll walk through: what the user actually saw, how I figured out what was really happening, how I proved it before touching anything, and what I changed. After that: the checks I actually ran, what's still left undone, and what came from AI assistance versus what I checked myself.

If you'd rather read it as commits instead of prose, the same five fixes (plus a tidy-up, a test commit and this file) are here, one topic per commit: https://github.com/m-elkady/Ricori/commits

## 1. The five bugs, one by one

### QA: two tabs, both "saved"

**What was reported:** two browser tabs open the same invoice, one edits the amount, the other edits it differently a moment later. Both get a success response. Whichever write happened to land last wins, silently — the other person has no idea their edit disappeared.

**How I found it:** I read `reviewDocument`. It reads the document, compares the revision number *in JavaScript*, and only afterwards runs a separate `UPDATE`. That gap between "check" and "write" is a classic race: two requests can both pass the check before either one writes.

**How we proved it, not just suspected it:** I didn't want to just trust the reasoning, so I forced the race on purpose. I built a second copy of the project in its own folder so I wouldn't touch anything real, opened a second terminal with `psql`, and held a lock on the document's row by hand. With that lock held, I fired both saves at the same time — they both had to wait. Then I released the lock and watched what happened. Sure enough: two `200`s instead of one `200` and one `409`, and the revision jumped by two instead of one.

**The fix:** put the revision check *inside* the same `UPDATE` statement as the write, so the database decides — under the row's own lock — instead of JavaScript deciding first and writing second. If the `UPDATE` changes nothing, that's either a stale revision (409) or a missing document (404).

### Accounts: saw another account's data

**What was reported:** a tester briefly saw processing history that belonged to a different account. In a later, fresh session, the same document looked "unavailable".

**How I found it:** the history endpoint caches its answer for 30 seconds to avoid repeating a database query. The problem is *where* the access check sat: it was written as part of the work that only runs when the cache is empty. So the very first request (any tenant) decides what gets cached under that document's id, and anyone asking for the same id within 30 seconds gets that same cached answer — right tenant or not.

**How we proved it:** created a document as one account, read its history as that account (fine), then immediately asked for the same document as a different account. It came back `200` with the first account's data. Deleting the document and asking again as the original account also came back `200` — the cache didn't know it had just been deleted.

**The fix:** always check that the document belongs to the requesting tenant and isn't deleted *before* even looking at the cache, and make the cache key include the tenant, not just the document id.

### Support: two processing entries after an interrupted session

**What was reported:** after something interrupted a worker mid-run, one invoice ended up with two processing entries and a doubled count.

**How I found it:** a worker does three things for one job: save the result, publish it to the overview, and mark the job done — and those used to happen as separate steps. If the process died between "save" and "mark done", the job was left looking unfinished. Once its lease expired, another worker would pick it up again — with a *new* claim token. The duplicate-prevention key was built from that token, so the second attempt looked like a brand new result to the database, and went through.

**How we proved it:** rather than waiting for a real crash, I recreated exactly the state a crash leaves behind — a result saved, but the job still marked "running" with an expired lease — and ran the worker on it again. It produced a second result row every time, on the original code.

**The fix:** base the duplicate-prevention key on the job's own id, which never changes no matter how many times it's retried. And save the result and mark the job done in one single database transaction, so a crash can't catch it between the two.

### Product: a corrected amount came back

**What was reported:** a user corrected an invoice's amount, and some time later the old, pre-correction amount came back.

**How I found it:** a worker is only allowed to write if a version number on the document still matches the version the job was started with. A correction bumps the document's revision, but it was *not* bumping that version number — so a job that had already started before the correction still matched, and happily overwrote the correction with the old extracted data.

**How we proved it:** created a document, claimed its job but didn't run it yet, corrected the amount through the normal edit endpoint, and only then let that old job finish. The correction got overwritten.

**The fix:** have a correction also bump that version number, so any job already in flight is rejected instead of applied — and make sure the rejected job is properly closed, not retried forever. A genuine request to reprocess still works, because it starts a fresh job with the current version.

### Support: a removed invoice came back in the list

**What was reported:** a user deleted an invoice. It reappeared in the overview list, even though opening it directly gave a "not found".

**How I found it:** this is a mirror image of the previous bug — a timing gap, not a missing check. The worker used to publish its summary of a document to the overview table as a *separate step after* saving the result, using the copy of the document it already had in memory. If a delete happened to land in that gap, it removed the overview row — and then the worker's late, stale write put it right back.

**How we proved it:** I made that gap deliberately wide: held a lock on the overview row from `psql` so the worker got stuck exactly between "save" and "publish", then ran the delete, then released the lock and let the stuck publish continue. The deleted document came back in the overview every time.

**There was a second thing hiding in this one.** Fixing the gap meant the worker now holds the document's row lock while it also touches the overview row — and delete already touched both of those too, but in the opposite order. Two pieces of code locking the same two things in opposite order is exactly the recipe for a database deadlock. I found this while writing the test for the fix, before it ever reached anyone, and reordered delete to match.

**The fix:** publish the overview row inside the same transaction as saving the result, so there's no gap left for a delete to land in. Make delete cancel a job that's still running, not just a queued one, so a late result can't be produced at all. And make delete lock things in the same order as everything else (job first, then document), so the two can never deadlock. On top of that, the overview's own writer and reader got a couple of safety nets: it won't publish a document it's been told is deleted, it won't let an older snapshot overwrite a newer one, and the list itself double-checks against the real document table rather than trusting its own cache blindly.

## 2. Why this is enough, and what stayed the same

Every one of these fixes moves a decision from "two separate steps, hope nothing happens in between" to "one atomic step, guarded by the database itself" — either a lock, a single `UPDATE ... WHERE`, or one transaction instead of several.

None of it changes how the system behaves for a normal, non-racing user. After every single fix, I reran the full ordinary path by hand — create a document, let it process, read its history, correct it, delete it — and it looked exactly as it did before. That path is also covered by the project's original six tests, which still pass unchanged.

## 3. Checks — what actually ran, separated from what's left to check

Everything below actually ran, in Docker, on a disposable copy of the project so the real one was never at risk. Nothing here is a prediction.

| Check | Result |
| --- | --- |
| Build (`tsc`, included in `docker compose build`) | Passed |
| Original 6 tests, on the fixed code | Passed |
| New tests, split one file per fixed source file (`documents.test.ts`, `results.test.ts`, `queue.test.ts`, `listing.test.ts`) — 23 tests | Passed |
| Same new tests run again, pointed at the *original*, unfixed code | Failed where expected — they reproduce the actual bug |
| 10 repeated runs of the delete/finish race (bug 5) | No deadlock, no leaked overview row, every time |
| `npm run smoke` (full create → process → history → review → delete over real HTTP) | Passed |

What's not done, and would be worth doing before trusting this against the real database:
- A longer soak test under real concurrent load, rather than the handful of forced races above.
- Checking the fixes against a copy of actual production data, not just synthetic documents.

## 4. What's left, and some tradeoffs

- **Old bad data is not repaired.** Any duplicate result rows, inflated counts, or wrong overview entries created by the old code before this fix stay as they are. A one-off cleanup script could fix them if it matters.
- **A rejected stale job is marked the same as a normal success (`completed`), not something that says "this was actually superseded".** Good enough to stop it being retried, but it makes monitoring a little less clear than a dedicated status would.
- **A correction doesn't cancel a job that's already queued for the same document** — it just makes sure that job's result gets rejected when it finishes. Cancelling it outright would save a little wasted work, at the cost of touching more code.
- **The history cache is still per-process and up to 30 seconds stale for its own owner**, which the API's documented contract explicitly allows.
- `MANIFEST.sha256` (the file hash list) was left as it was and no longer matches the changed files.

## 5. AI assistance, and how I checked it

I used Claude (Opus, then Sonnet) throughout: to read the code and propose the cause of each report, to suggest each fix, to write the new tests, and to draft this file. Nothing was applied blind — each bug was explained to me in plain language first, and only committed after I'd approved it.

The main way I checked the AI's work wasn't by reading the diff and trusting it — it was by making it prove itself: reproducing every bug against the *original* code first, and only afterwards checking the same steps against the fix. For bug 5 specifically, a deadlock risk the first version of the fix would have introduced was caught by the new test *before* it was committed, not after. The full test suite, the smoke script, and the repeated concurrency run above were all things I had it run and show me the actual output of, not just claim had passed.
