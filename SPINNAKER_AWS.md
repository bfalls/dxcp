# Spinnaker Gate on AWS (Phase 7.6)

This phase hosts a minimal Spinnaker Gate on a single EC2 instance and wires DXCP to it via SSM.

## Architecture
- CDK stack: DxcpSpinnakerStack
- EC2 instance (t3.small by default) in the default VPC public subnet
- Docker Compose on the instance for a minimal Gate container
- Security group allows inbound Gate traffic on port 8084
- Optional Elastic IP (default) or Dynu DDNS for a stable Gate URL
- DDNS mode adds Caddy as a reverse proxy with HTTPS
- SSM parameters under /dxcp/config/ for DXCP to read

## Cost notes
- One EC2 instance (t3.small) and optional Elastic IP
- No EKS or managed Kubernetes
- Docker images are pulled on first boot only
- Leaving the stack up is the cheapest stable option for demos

## IP mode selection (eip vs ddns)
Default is Elastic IP.

Set via environment variable or CDK context:
- DXCP_SPINNAKER_IP_MODE=eip
- DXCP_SPINNAKER_IP_MODE=ddns

Optional admin CIDR to allow direct Gate access for testing:
- DXCP_SPINNAKER_ADMIN_CIDR=YOUR_IP/32
This also enables SSH access (port 22) from that CIDR.

Optional EC2 key pair name for SSH:
- DXCP_SPINNAKER_KEY_NAME=your-keypair-name
The deploy script will prompt to create or import a key pair if one is not set.

Optional Gate image override:
- DXCP_SPINNAKER_GATE_IMAGE=wwbgo/spinnaker:gate-1.20.0
The default is a legacy public image to keep the demo working; override with an official
Spinnaker Gate image tag if you have one.

## Bootstrap behavior
The deploy script runs a post-deploy bootstrap via SSM to install Docker Compose,
write the Spinnaker docker-compose file, and start the systemd service. This makes
the instance setup resilient even if cloud-init/user-data does not rerun on updates.

DDNS mode uses Dynu and expects these SSM parameters (with decryption):
- DYNU_USERNAME
- DYNU_PASSWORD
- DYNU_API_KEY
The Dynu hostname is set via DXCP_DYNU_HOSTNAME and cached by the deploy script.
DDNS mode enables Caddy and uses HTTPS at https://<hostname>.

## Verify Gate is reachable
1) Get the Gate URL from CDK outputs or SSM:
   - /dxcp/config/spinnaker_gate_url
2) Curl the health endpoint:
   - curl https://<gate-host>/health (ddns)
   - curl http://<gate-host>:8084/health (eip)

## DXCP configuration for Gate
- DxcpSpinnakerStack writes:
  - /dxcp/config/spinnaker_gate_url
  - /dxcp/config/spinnaker_base_url (compat)
- dxcp-api reads spinnaker_gate_url first, then spinnaker_base_url.
- DXCP_SPINNAKER_MODE remains "stub" by default (HTTP mode is not implemented in the MVP).

## Notes
- Gate is exposed on port 8084.
- This phase targets a minimal, low-cost instance. It is not production hardened.
