import { CfnOutput, Stack, StackProps, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";

export interface SpinnakerStackProps extends StackProps {
  configPrefix: string;
  ipMode: string;
  adminCidr: string;
  instanceType: string;
  dynuHostname: string;
  keyName?: string;
  gateImage?: string;
}

export class SpinnakerStack extends Stack {
  constructor(scope: Construct, id: string, props: SpinnakerStackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, "DefaultVpc", { isDefault: true });

    const securityGroup = new ec2.SecurityGroup(this, "SpinnakerSecurityGroup", {
      vpc,
      description: "Spinnaker Gate access",
      allowAllOutbound: true,
    });

    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8084), "Gate from Lambda egress");
    if (props.adminCidr.trim().length > 0) {
      securityGroup.addIngressRule(ec2.Peer.ipv4(props.adminCidr), ec2.Port.tcp(8084), "Gate from admin IP");
      securityGroup.addIngressRule(ec2.Peer.ipv4(props.adminCidr), ec2.Port.tcp(22), "SSH from admin IP");
    }
    if (props.ipMode === "ddns") {
      securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "Caddy HTTP");
      securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "Caddy HTTPS");
    }

    const role = new iam.Role(this, "SpinnakerInstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });
    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"));

    if (props.ipMode === "ddns") {
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["ssm:GetParameter", "ssm:GetParameters"],
          resources: [
            `arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter/DYNU_USERNAME`,
            `arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter/DYNU_PASSWORD`,
            `arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter/DYNU_API_KEY`,
          ],
        })
      );
    }

    const instance = new ec2.Instance(this, "SpinnakerInstance", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType(props.instanceType),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup,
      role,
      keyName: props.keyName,
    });
    Tags.of(instance).add("Name", "dxcp-spinnaker");

    const gateImage = props.gateImage || "us-docker.pkg.dev/spinnaker-community/docker/gate:latest";
    const userData = instance.userData;
    userData.addCommands(
      "set -euo pipefail",
      "dnf update -y",
      "dnf install -y docker awscli ec2-instance-connect",
      "mkdir -p /usr/libexec/docker/cli-plugins",
      "if ! docker compose version >/dev/null 2>&1; then",
      "  curl -fsSL https://github.com/docker/compose/releases/download/v2.24.6/docker-compose-linux-x86_64 -o /usr/libexec/docker/cli-plugins/docker-compose",
      "  chmod +x /usr/libexec/docker/cli-plugins/docker-compose",
      "fi",
      "systemctl enable --now docker",
      "mkdir -p /opt/spinnaker/bin",
      "mkdir -p /opt/spinnaker/caddy",
      "cat > /opt/spinnaker/docker-compose.yml <<'EOF'",
      "version: '3.8'",
      "services:",
      "  redis:",
      "    image: redis:7",
      "    restart: unless-stopped",
      "  gate:",
      `    image: ${gateImage}`,
      "    restart: unless-stopped",
      "    ports:",
      "      - '8084:8084'",
      "    environment:",
      "      JAVA_OPTS: '-Xms512m -Xmx1024m'",
      "      SPRING_APPLICATION_JSON: '{\"services\":{\"orca\":{\"baseUrl\":\"http://localhost:8083\"},\"clouddriver\":{\"baseUrl\":\"http://localhost:7002\"},\"front50\":{\"baseUrl\":\"http://localhost:8080\"},\"echo\":{\"baseUrl\":\"http://localhost:8089\"},\"fiat\":{\"baseUrl\":\"http://localhost:7003\"}}}'",
      "    depends_on:",
      "      - redis",
      ...(props.ipMode === "ddns"
        ? [
            "  caddy:",
            "    image: caddy:2",
            "    restart: unless-stopped",
            "    ports:",
            "      - '80:80'",
            "      - '443:443'",
            "    volumes:",
            "      - /opt/spinnaker/caddy/Caddyfile:/etc/caddy/Caddyfile:ro",
            "      - /opt/spinnaker/caddy/data:/data",
            "      - /opt/spinnaker/caddy/config:/config",
            "    depends_on:",
            "      - gate",
          ]
        : []),
      "EOF",
      ...(props.ipMode === "ddns"
        ? [
            "dnf install -y bind-utils",
            "cat > /opt/spinnaker/caddy/Caddyfile <<'EOF'",
            `${props.dynuHostname} {`,
            "  reverse_proxy gate:8084",
            "}",
            "EOF",
            "cat > /opt/spinnaker/bin/wait-for-dns.sh <<'EOF'",
            "#!/usr/bin/env bash",
            "set -euo pipefail",
            "TOKEN=$(curl -sS -X PUT 'http://169.254.169.254/latest/api/token' -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600')",
            "PUBLIC_IP=$(curl -sS -H \"X-aws-ec2-metadata-token: ${TOKEN}\" http://169.254.169.254/latest/meta-data/public-ipv4)",
            `HOSTNAME="${props.dynuHostname}"`,
            "echo \"Waiting for DNS ${HOSTNAME} to resolve to ${PUBLIC_IP}\"",
            "for i in $(seq 1 60); do",
            "  RESOLVED=$(dig +short ${HOSTNAME} @1.1.1.1 | tail -n 1)",
            "  if [ \"${RESOLVED}\" = \"${PUBLIC_IP}\" ]; then",
            "    echo \"DNS resolved to ${PUBLIC_IP}\"",
            "    exit 0",
            "  fi",
            "  sleep 5",
            "done",
            "echo \"DNS did not resolve to ${PUBLIC_IP} within timeout\" >&2",
            "exit 1",
            "EOF",
            "chmod +x /opt/spinnaker/bin/wait-for-dns.sh",
          ]
        : []),
      "cat > /etc/systemd/system/spinnaker-compose.service <<'EOF'",
      "[Unit]",
      "Description=Spinnaker Gate (docker compose)",
      "After=network-online.target docker.service",
      "Wants=network-online.target",
      "",
      "[Service]",
      "Type=oneshot",
      "RemainAfterExit=yes",
      "WorkingDirectory=/opt/spinnaker",
      ...(props.ipMode === "ddns"
        ? ["ExecStartPre=/opt/spinnaker/bin/wait-for-dns.sh"]
        : []),
      "ExecStart=/usr/bin/docker compose -f /opt/spinnaker/docker-compose.yml up -d",
      "ExecStop=/usr/bin/docker compose -f /opt/spinnaker/docker-compose.yml down",
      "",
      "[Install]",
      "WantedBy=multi-user.target",
      "EOF",
      "systemctl daemon-reload",
      "systemctl enable --now spinnaker-compose.service"
    );

    if (props.ipMode === "ddns") {
      userData.addCommands(
        "cat > /opt/spinnaker/bin/dynu-update.sh <<'EOF'",
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "TOKEN=$(curl -sS -X PUT 'http://169.254.169.254/latest/api/token' -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600')",
        "PUBLIC_IP=\"\"",
        "for i in $(seq 1 24); do",
        "  PUBLIC_IP=$(curl -sS -H \"X-aws-ec2-metadata-token: ${TOKEN}\" http://169.254.169.254/latest/meta-data/public-ipv4 || true)",
        "  if [[ -n \"${PUBLIC_IP}\" ]]; then",
        "    break",
        "  fi",
        "  sleep 5",
        "done",
        "if [[ -z \"${PUBLIC_IP}\" ]]; then",
        "  echo \"Public IP not available\" >&2",
        "  exit 1",
        "fi",
        "DYNU_USERNAME=$(aws ssm get-parameter --name DYNU_USERNAME --with-decryption --query 'Parameter.Value' --output text)",
        "DYNU_PASSWORD=$(aws ssm get-parameter --name DYNU_PASSWORD --with-decryption --query 'Parameter.Value' --output text)",
        "DYNU_API_KEY=$(aws ssm get-parameter --name DYNU_API_KEY --with-decryption --query 'Parameter.Value' --output text)",
        `curl -sS -u \"\${DYNU_USERNAME}:\${DYNU_PASSWORD}\" -H \"API-Key: \${DYNU_API_KEY}\" \"https://api.dynu.com/nic/update?hostname=${props.dynuHostname}&myip=\${PUBLIC_IP}\" >/var/log/dynu-update.log`,
        "EOF",
        "chmod +x /opt/spinnaker/bin/dynu-update.sh",
        "cat > /etc/systemd/system/dynu-update.service <<'EOF'",
        "[Unit]",
        "Description=Update Dynu DDNS",
        "After=network-online.target",
        "Wants=network-online.target",
        "",
        "[Service]",
        "Type=oneshot",
        "ExecStart=/opt/spinnaker/bin/dynu-update.sh",
        "EOF",
        "systemctl daemon-reload",
        "systemctl enable dynu-update.service",
        "systemctl start dynu-update.service"
      );
    }

    let gateUrl: string;
    if (props.ipMode === "ddns") {
      gateUrl = `https://${props.dynuHostname}`;
    } else {
      const eip = new ec2.CfnEIP(this, "SpinnakerEip", { domain: "vpc" });
      new ec2.CfnEIPAssociation(this, "SpinnakerEipAssociation", {
        allocationId: eip.attrAllocationId,
        instanceId: instance.instanceId,
      });
      gateUrl = `http://${eip.ref}:8084`;
      new CfnOutput(this, "SpinnakerElasticIp", { value: eip.ref });
    }

    new ssm.StringParameter(this, "SpinnakerGateUrl", {
      parameterName: `${props.configPrefix}/spinnaker_gate_url`,
      stringValue: gateUrl,
    });

    new ssm.StringParameter(this, "SpinnakerBaseUrlCompat", {
      parameterName: `${props.configPrefix}/spinnaker_base_url`,
      stringValue: gateUrl,
    });

    new CfnOutput(this, "SpinnakerGateUrlOutput", { value: gateUrl });
    new CfnOutput(this, "SpinnakerInstanceId", { value: instance.instanceId });
  }
}
