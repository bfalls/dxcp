#!/usr/bin/env bash
set -euo pipefail

is_windows=0
case "${OS:-}" in
  Windows_NT) is_windows=1 ;;
esac

have() {
  command -v "$1" >/dev/null 2>&1
}

print_header() {
  printf '\n== %s ==\n' "$1"
}

print_kv() {
  printf '%-22s %s\n' "$1" "$2"
}

print_header "Shell Doctor"
print_kv "date_utc" "$(date -u +"%Y-%m-%dT%H:%M:%SZ" || true)"
print_kv "shell" "${SHELL:-unknown}"
print_kv "pwd" "$(pwd)"
print_kv "os" "${OS:-unknown}"

print_header "Binary Resolution"
for bin in bash curl curl.exe openssl openssl.exe jq python py npm node; do
  if have "$bin"; then
    print_kv "$bin" "$(command -v "$bin")"
  else
    print_kv "$bin" "MISSING"
  fi
done

print_header "Recommended Command Style"
if [[ "$is_windows" -eq 1 ]]; then
  cat <<'EOF'
1) For repo scripts: use bash explicitly
   bash -lc './scripts/deploy_aws.sh'

2) For HTTP in Git Bash on Windows: prefer curl.exe
   curl.exe -sS -I https://example.com

3) For cert operations in Git Bash on Windows: prefer openssl.exe if present
   openssl.exe version

4) Quote Windows paths with spaces:
   "C:\Program Files\PowerShell\7\pwsh.exe"
EOF
else
  cat <<'EOF'
1) Use native bash + curl + openssl commands directly.
2) Quote paths with spaces.
EOF
fi

print_header "Path Sanity (Windows cert path examples)"
if [[ "$is_windows" -eq 1 ]]; then
  cat <<'EOF'
Use one style per command:
- Git Bash style: /c/Users/<user>/...
- Windows style:  C:\Users\<user>\...
Do not mix both styles in the same command line.
EOF
else
  echo "Not running on Windows_NT; skipping Windows path advice."
fi

print_header "Quick Connectivity Checks"
cat <<'EOF'
Local gate health (expected 200 when local proxy is up):
  curl.exe -sS -k -i https://127.0.0.1:8443/health

Machine endpoint with explicit host resolve:
  curl.exe -sS -k -i --resolve gate-api.ddnsfree.com:443:127.0.0.1 https://gate-api.ddnsfree.com/health
EOF

print_header "Done"
