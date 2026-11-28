#!/usr/bin/env python3
"""Summarize mined eval steps (mine.mjs output): failures grouped by message with
the failing line, the most used calls, and evals per turn (a cap shows as a spike).

usage: analyze.py steps.jsonl [more.jsonl …]"""
import json, re, sys, collections
R = [json.loads(l) for f in sys.argv[1:] for l in open(f)]
print('steps', len(R), dict(collections.Counter(r.get('status') for r in R)))
def out(r):
    o = r.get('out') or ''
    try: o = json.loads(o)
    except Exception: pass
    return str(o)
groups = collections.defaultdict(list)
for r in R:
    if r.get('status') != 'error': continue
    o = out(r); groups[re.sub(r'\(line \d+\)', '(line N)', o)[:120]].append(r)
for k, rs in sorted(groups.items(), key=lambda kv: -len(kv[1])):
    print(f'\n{len(rs)} × {k}')
    for r in rs[:4]:
        m = re.search(r'\(line (\d+)\)', out(r)); lines = r['code'].split('\n')
        if m and int(m.group(1)) <= len(lines): print(f"    {r['app']}: {lines[int(m.group(1)) - 1].strip()[:120]}")
calls = collections.Counter(a + '.' + b for r in R for a, b in re.findall(r'\b(files|app|frames|scenarios|fixtures|session|types|ui|lib|publish|agents|snapshots)\.([A-Za-z]+)\s*\(', r['code']))
print('\ntop calls:', ', '.join(f'{k} {v}' for k, v in calls.most_common(25)))
per = collections.Counter((r['app'], r['thread'], r['turn']) for r in R)
print('evals per turn:', sorted(collections.Counter(per.values()).items()))
