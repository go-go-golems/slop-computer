# tasks.py OUT EXPECTED: 50 tasks, fixed seed; EXPECTED gets the overdue count
# (due before today and not done), today being the day the run starts.
import csv, datetime, random, sys
random.seed(26)
# UTC, as in the box (round 3: the host's EST date was a day behind the
# agent's, and the checker's count was wrong, not the agent's).
today = datetime.datetime.now(datetime.timezone.utc).date()
owners = ["ana", "ben", "chris", "dana", "eli"]
rows, overdue = [], 0
for i in range(1, 51):
    due = today + datetime.timedelta(days=random.randint(-20, 20))
    done = random.random() < 0.35
    if due < today and not done:
        overdue += 1
    rows.append({"id": f"T{i:03d}", "title": f"Task {i}", "owner": random.choice(owners), "due": due.isoformat(), "done": "yes" if done else "no"})
with open(sys.argv[1], "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0]))
    w.writeheader(); w.writerows(rows)
open(sys.argv[2], "w").write(str(overdue))
