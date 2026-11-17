#!/usr/bin/env python3
"""Redact a round's archive before it is committed.

- The output of any persona bash call that ran the operator's `slop` CLI
  (round 3: a persona found it on PATH) becomes a placeholder.
- The operator's identity (OPERATOR_NAME, OPERATOR_EMAIL, OPERATOR_ID
  from the environment) is masked in every text file.
- Link tokens (k_...) standing alone are masked; base64 blobs that merely
  contain "k_" are left alone.

usage: OPERATOR_NAME=... OPERATOR_EMAIL=... OPERATOR_ID=... redact.py <archived round dir>
"""
import json, os, re, sys, pathlib
root = pathlib.Path(sys.argv[1])
ids = [v for v in (os.environ.get(k) for k in ('OPERATOR_NAME', 'OPERATOR_EMAIL', 'OPERATOR_ID')) if v]
CLI = re.compile(r'(^|[;&|(\s])slop(\s|$)')
TOK = re.compile(r'(?<![A-Za-z0-9+/=_-])k_[A-Za-z0-9_-]{16,}')
def mask(t):
    for v in ids: t = t.replace(v, '[the operator]')
    return TOK.sub('k_[redacted]', t)
n_cli = n_files = 0
for f in root.rglob('*'):
    if not f.is_file() or f.suffix not in ('.jsonl', '.md', '.txt', '.out', '.err', '.json') and not re.search(r'\.(out|err)\.\d+$', f.name): continue
    text = f.read_text(errors='replace')
    if f.suffix == '.jsonl' and f.parent.name == 'session':
        calls, out = set(), []
        for line in text.splitlines():
            try: o = json.loads(line)
            except Exception: out.append(mask(line)); continue
            m = o.get('message') or {}
            for c in (m.get('content') if isinstance(m.get('content'), list) else []):
                if c.get('type') == 'toolCall' and c.get('name') == 'bash' and CLI.search(str((c.get('arguments') or {}).get('command', ''))): calls.add(c.get('id'))
            if m.get('role') == 'toolResult' and m.get('toolCallId') in calls:
                m['content'] = [{'type': 'text', 'text': "[redacted: the output of the operator's slop command line, which this persona should not have reached]"}]; n_cli += 1
            out.append(mask(json.dumps(o, ensure_ascii=False)))
        new = '\n'.join(out) + '\n'
    else:
        new = mask(text)
    if new != text: f.write_text(new); n_files += 1
print(f'redacted {n_cli} CLI outputs; changed {n_files} files')
