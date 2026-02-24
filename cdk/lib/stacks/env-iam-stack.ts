import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { ArnPrincipal, CompositePrincipal, Effect, PolicyDocument, PolicyStatement, Role, User } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface EnvIamStackProps extends StackProps {
  environmentName: "dev" | "staging" | "prod";
  assumerRoleArn: string;
  additionalTrustedUserArn?: string;
}

export interface EnvIamAssumerStackProps extends StackProps {
  targetRoleArns: string[];
  trustedPrincipalArn?: string;
  localUserName?: string;
}

export class EnvIamStack extends Stack {
  public readonly roleArn: string;

  constructor(scope: Construct, id: string, props: EnvIamStackProps) {
    super(scope, id, props);

    const envName = props.environmentName;
    const roleName = `spinnaker-${envName}-role`;
    const environmentTagCondition = { StringEquals: { "aws:ResourceTag/Environment": envName } };
    const createTagCondition = {
      StringEquals: { "aws:RequestTag/Environment": envName },
      "ForAllValues:StringEquals": { "aws:TagKeys": ["Environment"] },
    };
    const demoLambdaFunctionArns = [
      `arn:aws:lambda:${this.region}:${this.account}:function:demo-service*`,
      `arn:aws:lambda:${this.region}:${this.account}:function:demo-service-2*`,
    ];

    const role = new Role(this, "SpinnakerEnvRole", {
      roleName,
      assumedBy: new ArnPrincipal(`arn:aws:iam::${this.account}:root`).withConditions({
        ArnEquals: { "aws:PrincipalArn": props.assumerRoleArn },
      }),
      inlinePolicies: {
        SpinnakerScopedStarterPolicy: new PolicyDocument({
          statements: [
            // Discovery/read-only starter permissions.
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: [
                "ec2:Describe*",
                "autoscaling:Describe*",
                "elasticloadbalancing:Describe*",
                "cloudwatch:DescribeAlarms",
                "cloudwatch:DescribeAlarmsForMetric",
                "cloudwatch:DescribeAlarmHistory",
                "cloudwatch:GetMetricData",
                "cloudwatch:ListMetrics",
                "acm:ListCertificates",
                "acm:DescribeCertificate",
                "acm:GetCertificate",
                "iam:GetRole",
                "iam:ListRoles",
                "iam:ListInstanceProfiles",
                "iam:ListServerCertificates",
                "iam:GetInstanceProfile",
              ],
              resources: ["*"],
            }),
            // Mutations must target resources tagged with Environment=<env>.
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: [
                "ec2:StartInstances",
                "ec2:StopInstances",
                "ec2:RebootInstances",
                "ec2:TerminateInstances",
                "ec2:ModifyInstanceAttribute",
                "ec2:AuthorizeSecurityGroupIngress",
                "ec2:AuthorizeSecurityGroupEgress",
                "ec2:RevokeSecurityGroupIngress",
                "ec2:RevokeSecurityGroupEgress",
                "ec2:DeleteSecurityGroup",
                "ec2:CreateTags",
                "ec2:DeleteTags",
                "autoscaling:UpdateAutoScalingGroup",
                "autoscaling:DeleteAutoScalingGroup",
                "autoscaling:SetDesiredCapacity",
                "autoscaling:PutScalingPolicy",
                "autoscaling:DeletePolicy",
                "elasticloadbalancing:ModifyLoadBalancerAttributes",
                "elasticloadbalancing:DeleteLoadBalancer",
                "elasticloadbalancing:RegisterTargets",
                "elasticloadbalancing:DeregisterTargets",
                "elasticloadbalancing:ModifyTargetGroup",
                "elasticloadbalancing:DeleteTargetGroup",
                "elasticloadbalancing:ModifyListener",
                "elasticloadbalancing:DeleteListener",
              ],
              resources: ["*"],
              conditions: environmentTagCondition,
            }),
            // Create APIs require request tagging with Environment=<env>.
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: [
                "ec2:RunInstances",
                "ec2:CreateVolume",
                "ec2:CreateSecurityGroup",
                "ec2:CreateLaunchTemplate",
                "autoscaling:CreateAutoScalingGroup",
                "elasticloadbalancing:CreateLoadBalancer",
                "elasticloadbalancing:CreateTargetGroup",
                "elasticloadbalancing:CreateListener",
              ],
              resources: ["*"],
              conditions: createTagCondition,
            }),
            // Limit role passing to explicitly tagged roles and common target services.
            // TODO: tighten/expand this service set once the concrete deploy target is selected.
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["iam:PassRole"],
              resources: ["*"],
              conditions: {
                StringEquals: {
                  "iam:PassedToService": [
                    "ec2.amazonaws.com",
                    "ecs-tasks.amazonaws.com",
                    "autoscaling.amazonaws.com",
                  ],
                  "aws:ResourceTag/Environment": envName,
                },
              },
            }),
            // Allow native Spinnaker Lambda code deployments for the DXCP demo services.
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: [
                "lambda:GetFunction",
                "lambda:GetFunctionConfiguration",
                "lambda:GetAlias",
                "lambda:ListAliases",
                "lambda:ListVersionsByFunction",
                "lambda:InvokeFunction",
                "lambda:UpdateFunctionCode",
                "lambda:PublishVersion",
                "lambda:UpdateAlias",
                "lambda:CreateAlias",
                "lambda:DeleteAlias",
              ],
              resources: demoLambdaFunctionArns,
            }),
          ],
        }),
      },
    });

    if (props.additionalTrustedUserArn) {
      role.assumeRolePolicy?.addStatements(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["sts:AssumeRole"],
          principals: [new ArnPrincipal(`arn:aws:iam::${this.account}:root`)],
          conditions: {
            ArnEquals: { "aws:PrincipalArn": props.additionalTrustedUserArn },
          },
        }),
      );
    }

    this.roleArn = role.roleArn;
    new CfnOutput(this, "SpinnakerRoleArn", { value: this.roleArn });
  }
}

export class EnvIamAssumerStack extends Stack {
  public readonly roleArn: string;

  constructor(scope: Construct, id: string, props: EnvIamAssumerStackProps) {
    super(scope, id, props);

    const trustedPrincipal = props.trustedPrincipalArn
      ? new CompositePrincipal(new ArnPrincipal(`arn:aws:iam::${this.account}:root`), new ArnPrincipal(props.trustedPrincipalArn))
      : new ArnPrincipal(`arn:aws:iam::${this.account}:root`);

    const role = new Role(this, "SpinnakerAssumerRole", {
      roleName: "spinnaker-assumer-role",
      assumedBy: trustedPrincipal,
    });

    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["sts:AssumeRole"],
        resources: props.targetRoleArns,
      }),
    );

    const localUser = new User(this, "SpinnakerLocalUser", {
      userName: props.localUserName ?? "spinnaker-local-user",
    });
    localUser.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "ec2:DescribeRegions",
          "ec2:DescribeAvailabilityZones",
          "ec2:DescribeVpcs",
          "ec2:DescribeSubnets",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeRouteTables",
          "ec2:DescribeInternetGateways",
          "ec2:DescribeNatGateways",
          "ec2:DescribeNetworkAcls",
          "ec2:DescribeTags",
          "ec2:DescribeInstances",
          "ec2:DescribeImages",
          "ec2:DescribeKeyPairs",
          "elasticloadbalancing:Describe*",
          "autoscaling:Describe*",
          "iam:ListInstanceProfiles",
          "iam:GetInstanceProfile",
        ],
        resources: ["*"],
      }),
    );
    localUser.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["sts:AssumeRole"],
        resources: props.targetRoleArns,
      }),
    );

    this.roleArn = role.roleArn;
    new CfnOutput(this, "SpinnakerAssumerRoleArn", { value: this.roleArn });
    new CfnOutput(this, "SpinnakerLocalUserArn", { value: localUser.userArn });
  }
}
