# DXCP -> Gate mTLS (Option 1)

This runbook configures a machine-only Gate endpoint protected by mTLS.

Scope:
- Keep existing Deck/UI OAuth routing unchanged.
- Add a separate Gate machine endpoint for DXCP.
- Require client certificate verification at Caddy.

## 1) Generate local certs (not committed)

From repo root:

```bash
mkdir -p ops/certs

openssl genrsa -out ops/certs/ca.key 4096
openssl req -x509 -new -nodes -key ops/certs/ca.key -sha256 -days 3650 \
  -subj "/CN=dxcp-gate-client-ca" \
  -out ops/certs/ca.crt

openssl genrsa -out ops/certs/dxcp-client.key 2048
openssl req -new -key ops/certs/dxcp-client.key \
  -subj "/CN=dxcp-api-client" \
  -out ops/certs/dxcp-client.csr

openssl x509 -req -in ops/certs/dxcp-client.csr \
  -CA ops/certs/ca.crt -CAkey ops/certs/ca.key -CAcreateserial \
  -out ops/certs/dxcp-client.crt -days 825 -sha256

rm -f ops/certs/dxcp-client.csr
```

PowerShell equivalent:

```powershell
New-Item -ItemType Directory -Force ops/certs | Out-Null

openssl genrsa -out ops/certs/ca.key 4096
openssl req -x509 -new -nodes -key ops/certs/ca.key -sha256 -days 3650 `
  -subj "/CN=dxcp-gate-client-ca" `
  -out ops/certs/ca.crt

openssl genrsa -out ops/certs/dxcp-client.key 2048
openssl req -new -key ops/certs/dxcp-client.key `
  -subj "/CN=dxcp-api-client" `
  -out ops/certs/dxcp-client.csr

openssl x509 -req -in ops/certs/dxcp-client.csr `
  -CA ops/certs/ca.crt -CAkey ops/certs/ca.key -CAcreateserial `
  -out ops/certs/dxcp-client.crt -days 825 -sha256

Remove-Item ops/certs/dxcp-client.csr -ErrorAction SilentlyContinue
```

## 2) Caddy machine endpoint

Use [Caddyfile.mtls.example](./caddy/Caddyfile.mtls.example) as the reference.

Important:
- Do not change existing UI/OAuth routes.
- Add a separate machine endpoint with `require_and_verify` client auth.
- Trust only `ops/certs/ca.crt` for client cert validation.

## 3) DXCP runtime config

Set:

```bash
export DXCP_SPINNAKER_GATE_URL="https://gate-api.example.internal"
export DXCP_SPINNAKER_MTLS_CERT_PATH="/app/certs/dxcp-client.crt"
export DXCP_SPINNAKER_MTLS_KEY_PATH="/app/certs/dxcp-client.key"
export DXCP_SPINNAKER_MTLS_CA_PATH="/app/certs/ca.crt"  # optional
```

SSM equivalents:

```bash
aws ssm put-parameter --name /dxcp/config/spinnaker/gate_url --type String --value "https://gate-api.example.internal" --overwrite
aws ssm put-parameter --name /dxcp/config/spinnaker/mtls_cert_path --type String --value "/app/certs/dxcp-client.crt" --overwrite
aws ssm put-parameter --name /dxcp/config/spinnaker/mtls_key_path --type String --value "/app/certs/dxcp-client.key" --overwrite
aws ssm put-parameter --name /dxcp/config/spinnaker/mtls_ca_path --type String --value "/app/certs/ca.crt" --overwrite
```

## 4) Verification

With client cert:

```bash
curl -sS --cert ops/certs/dxcp-client.crt --key ops/certs/dxcp-client.key \
  https://gate-api.example.internal/health
```

Without client cert (should fail TLS handshake):

```bash
curl -v https://gate-api.example.internal/health
```

Expected:
- mTLS call succeeds.
- no-cert call fails before upstream proxying.

## 5) Governance test

Run:

```bash
npm run e2e-gov --prefix ui -- --reporter=line
```

Step F should no longer fail with Auth0 HTML redirect content.
