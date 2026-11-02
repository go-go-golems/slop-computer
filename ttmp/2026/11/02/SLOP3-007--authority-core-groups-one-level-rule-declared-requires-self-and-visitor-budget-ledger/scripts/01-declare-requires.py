"""Convert actor.js actions to the object form with requires.

usage: requires.py <actor.js> [name=level ...]
Actions written as `    [async ]name(args) {` at four spaces, ending at
`    },`, become `name: { requires, [async ]run(args) {...} }`. A leading
`ctx.need('x');` becomes requires 'x' and is removed; other actions need
an explicit name=level argument, else they are listed and left alone."""
import re, sys, pathlib
path = pathlib.Path(sys.argv[1]); given = dict(a.split('=') for a in sys.argv[2:])
lines = path.read_text().split('\n')
start = next(i for i, l in enumerate(lines) if re.match(r'^  actions: \{\s*$', l))
end = next(i for i in range(start + 1, len(lines)) if re.match(r'^  \},?\s*$', lines[i]))
out, i, todo = lines[:start + 1], start + 1, []
head = re.compile(r'^    (async )?([A-Za-z_$][\w$]*)\((.*)\) \{\s*(//.*)?$')
while i < end:
    m = head.match(lines[i])
    if not m:
        out.append(lines[i]); i += 1; continue
    j = next(k for k in range(i + 1, end) if re.match(r'^    \},\s*$', lines[k]))
    body = lines[i + 1:j]
    level, comment = None, ''
    need = re.match(r"^      ctx\.need\('(\w+)'\);\s*(//.*)?$", body[0]) if body else None
    if need:
        level, comment, body = need.group(1), (' ' + need.group(2) if need.group(2) else ''), body[1:]
    level = given.get(m.group(2), level)
    if not level:
        todo.append(m.group(2)); out.extend(lines[i:j + 1]); i = j + 1; continue
    trail = ' ' + m.group(4) if m.group(4) else ''
    out.append(f"    {m.group(2)}: {{")
    out.append(f"      requires: '{level}',{comment}")
    out.append(f"      {m.group(1) or ''}run({m.group(3)}) {{{trail}")
    out.extend(('  ' + b) if b.strip() else b for b in body)
    out.append('      },')
    out.append('    },')
    i = j + 1
out.extend(lines[end:])
path.write_text('\n'.join(out))
print(path, 'left as is:', todo)
