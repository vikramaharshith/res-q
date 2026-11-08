#!/usr/bin/env bash
# Run from web/. Local-only; does not use any operator database credentials.
set -euo pipefail
fixture_dir=$(mktemp -d)
fixture_pid=''
app_pid=''
cleanup() {
  if [ -n "$app_pid" ]; then kill "$app_pid" 2>/dev/null || true; fi
  if [ -n "$fixture_pid" ]; then kill "$fixture_pid" 2>/dev/null || true; fi
  rm -rf "$fixture_dir"
}
trap cleanup EXIT
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$fixture_dir/key.pem" -out "$fixture_dir/cert.pem" -days 1 -subj /CN=localhost -addext 'subjectAltName=IP:127.0.0.1,DNS:localhost' >"$fixture_dir/cert.log" 2>&1
export RESQ_TEST_KEY="$fixture_dir/key.pem"
export RESQ_TEST_CERT="$fixture_dir/cert.pem"
node --experimental-strip-types --import ./scripts/register-demo-import.mjs ./scripts/serve-chaos-test-db.mts >"$fixture_dir/fixture.log" 2>&1 &
fixture_pid=$!
SUPABASE_URL=https://127.0.0.1:5443 NEXT_PUBLIC_SUPABASE_URL=https://127.0.0.1:5443 SUPABASE_SECRET_KEY=sb_secret_local_fixture RESQ_LOCAL_APPROVALS=0 NODE_EXTRA_CA_CERTS="$fixture_dir/cert.pem" node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100 >"$fixture_dir/app.log" 2>&1 &
app_pid=$!
for attempt in $(seq 1 100); do
  if curl -sf --cacert "$fixture_dir/cert.pem" https://127.0.0.1:5443/test-stats >/dev/null && curl -sf http://127.0.0.1:3100/ >/dev/null; then break; fi
  if ! kill -0 "$fixture_pid" 2>/dev/null || ! kill -0 "$app_pid" 2>/dev/null; then cat "$fixture_dir/fixture.log" "$fixture_dir/app.log"; exit 1; fi
  sleep 0.2
done
node scripts/benchmark-chaos-http.mjs
if [ "${RESQ_TEST_BROWSER:-0}" = 1 ]; then node scripts/benchmark-large-chaos.mjs; fi
