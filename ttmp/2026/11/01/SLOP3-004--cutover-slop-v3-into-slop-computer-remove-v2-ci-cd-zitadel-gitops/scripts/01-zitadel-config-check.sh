#!/bin/sh
# Runs the slop-v3:pr-check image with a production slop.yaml (GitOps
# configmap.yaml, placeholder client id in secrets/oidc-client-id) and
# checks sign-in against the real ZITADEL discovery, probes and host roles.
set -u
S=${1:?usage: 01-zitadel-config-check.sh <dir with slop.yaml and secrets/oidc-client-id>}
docker rm -f slop-zcheck >/dev/null 2>&1
docker run -d --name slop-zcheck -p 127.0.0.1:18398:8080 \
  -v "$S/slop.yaml:/etc/slop/slop.yaml:ro" -v "$S/secrets:/run/secrets/slop:ro" \
  --tmpfs /var/lib/slop:uid=10001 slop-v3:pr-check \
  serve --config=/etc/slop/slop.yaml --listen=0.0.0.0:8080 --data=/var/lib/slop/v3 >/dev/null
for i in $(seq 1 20); do curl -fsS http://127.0.0.1:18398/readyz >/dev/null 2>&1 && break; sleep 0.5; done
B=http://127.0.0.1:18398
code() { curl -s -o /dev/null -w '%{http_code}' -H "Host: $1" "$B$2"; }
echo "probes on the pod address: healthz $(code 10.42.0.7:8080 /healthz), readyz $(code 10.42.0.7:8080 /readyz), / $(code 10.42.0.7:8080 /)"
echo "main /auth/session: $(curl -s -H 'Host: slop.yolo.scapegoat.dev' -H 'X-Forwarded-Proto: https' $B/auth/session)"
loc=$(curl -s -o /dev/null -w '%{redirect_url}' -H 'Host: slop.yolo.scapegoat.dev' -H 'X-Forwarded-Proto: https' "$B/auth/login?return=/admin")
python3 -c "
import sys,urllib.parse as u
q=u.urlparse(sys.argv[1]); p={k:v[0] for k,v in u.parse_qs(q.query).items()}
print('login ->', q.scheme+'://'+q.netloc+q.path)
for k in ['client_id','redirect_uri','scope','code_challenge_method','response_type']: print('  ', k, '=', p.get(k))
print('   state, nonce, code_challenge present:', all(p.get(k) for k in ['state','nonce','code_challenge']))" "$loc"
echo "flow cookie: $(curl -s -D - -o /dev/null -H 'Host: slop.yolo.scapegoat.dev' $B/auth/login | grep -i '^set-cookie' | sed -E 's/=[^;]+;/=<value>;/' | tr -d '\r')"
echo "live host /_site/me: $(curl -s -H 'Host: apps.slop.yolo.scapegoat.dev' $B/_site/me | head -c 200)"
echo "static host /: $(code site.slop.yolo.scapegoat.dev /)"
echo "sandbox host: $(code s0123456789abcdef0123.sbx.slop.yolo.scapegoat.dev /)"
echo "log:"; docker logs slop-zcheck 2>&1 | head -8
docker rm -f slop-zcheck >/dev/null
