#!/bin/sh
cd /home/claude/lab && UI=0 node build.mjs test/out >/dev/null && cp test/ktest.html test/out/index.html && timeout 150 node spike/run.mjs test/out 2>&1 | python3 -c "
import sys,json
data=sys.stdin.read()
i=data.find('{\n')
print(data[:i][-4000:])
try:
  d=json.loads(data[i:])
  for l in d.get('log',[]): print(l); print()
  for k in ('error','stack','fatal'):
    if k in d: print(k.upper(), d[k])
except Exception as e: print('PARSE', e, data[i:][:3000])
"
