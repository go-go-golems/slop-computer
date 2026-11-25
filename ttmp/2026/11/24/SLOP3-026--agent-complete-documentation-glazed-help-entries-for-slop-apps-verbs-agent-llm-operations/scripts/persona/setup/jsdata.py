# jsdata.py OUTDIR EXPECTED: fixed-seed data for the JS API scenarios, with
# dates in UTC (as in the box). EXPECTED gets what the checkers compare with.
import csv, datetime, json, os, random, sys
out, exp = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
random.seed(26)
today = datetime.datetime.now(datetime.timezone.utc).date()
first = today.replace(day=1)
prev_last = first - datetime.timedelta(days=1)
def write(name, rows):
    with open(os.path.join(out, name), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
# orders: this month and last month
customers = ["Ana Ruiz", "Ben Okafor", "Chris Lee", "Dana Wu", "Eli Novak"]
orders, this_month = [], []
for i in range(1, 31):
    if i % 5 < 2:
        d = first + datetime.timedelta(days=random.randint(0, (today - first).days))
    else:
        d = prev_last - datetime.timedelta(days=random.randint(0, 25))
    o = {"id": f"O{i:03d}", "customer": random.choice(customers), "amount": f"{random.randint(12, 480)}.{random.choice(['00','50','95'])}", "date": d.isoformat()}
    orders.append(o)
    if d >= first: this_month.append(o["id"])
write("orders.csv", orders)
# tasks for the digest
tasks = [{"id": f"t{i:02d}", "title": t, "done": "true" if i in (2, 5, 8, 11, 12) else "false"} for i, t in enumerate(
    ["Book venue", "Order badges", "Print schedule", "Email speakers", "Test projector", "Buy snacks",
     "Set up chairs", "Confirm caterer", "Post on blog", "Hire photographer", "Pick up keys", "Send invoices"], 1)]
write("tasks.csv", tasks)
# sales and support for the dashboard
sales = [{"id": f"s{i}", "region": random.choice(["north", "south"]), "amount": str(random.randint(150, 900))} for i in range(1, 9)]
support = [{"id": f"k{i}", "subject": f"Ticket {i}", "status": "open" if i in (1, 3, 4, 7) else "closed"} for i in range(1, 10)]
write("sales.csv", sales); write("support.csv", support)
json.dump({
    "ordersThisMonth": this_month, "month": first.strftime("%Y-%m"),
    "openTasks": sum(t["done"] == "false" for t in tasks), "tasks": len(tasks),
    "salesTotal": sum(int(s["amount"]) for s in sales), "openTickets": sum(k["status"] == "open" for k in support),
    "items": ["bolts", "nuts", "washers", "hinges", "brackets", "screws"],
}, open(exp, "w"), indent=1)
