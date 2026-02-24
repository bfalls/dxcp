#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ApiStack } from "../lib/api-stack";
import { DataStack } from "../lib/data-stack";
import { DemoRuntimeStack } from "../lib/demo-runtime-stack";
import { EnvDemoRuntimeStack } from "../lib/stacks/env-demo-runtime-stack";
import { EnvVpcStack } from "../lib/env-vpc-stack";
import { EnvIamAssumerStack, EnvIamStack } from "../lib/stacks/env-iam-stack";
import { UiStack } from "../lib/ui-stack";

const app = new cdk.App();

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || "us-east-1";

const configPrefix = app.node.tryGetContext("configPrefix") || "/dxcp/config";
const killSwitch = app.node.tryGetContext("killSwitch") || process.env.DXCP_KILL_SWITCH || "0";
const demoMode = app.node.tryGetContext("demoMode") || process.env.DXCP_DEMO_MODE || "true";
const apiToken = app.node.tryGetContext("apiToken") || process.env.DXCP_API_TOKEN || "";
const ciPublishers = app.node.tryGetContext("ciPublishers") || process.env.DXCP_CI_PUBLISHERS || "ci-publisher-1";
const readRpm = app.node.tryGetContext("readRpm") || process.env.DXCP_READ_RPM || "60";
const mutateRpm = app.node.tryGetContext("mutateRpm") || process.env.DXCP_MUTATE_RPM || "10";
const dailyQuotaDeploy = app.node.tryGetContext("dailyQuotaDeploy") || process.env.DXCP_DAILY_QUOTA_DEPLOY || "25";
const dailyQuotaRollback = app.node.tryGetContext("dailyQuotaRollback") || process.env.DXCP_DAILY_QUOTA_ROLLBACK || "10";
const dailyQuotaBuildRegister = app.node.tryGetContext("dailyQuotaBuildRegister") || process.env.DXCP_DAILY_QUOTA_BUILD_REGISTER || "50";
const dailyQuotaUploadCapability = app.node.tryGetContext("dailyQuotaUploadCapability") || process.env.DXCP_DAILY_QUOTA_UPLOAD_CAPABILITY || "50";
const corsOriginsRaw = app.node.tryGetContext("corsOrigins") || process.env.DXCP_CORS_ORIGINS || "*";
const spinnakerMode = app.node.tryGetContext("spinnakerMode") || process.env.DXCP_SPINNAKER_MODE || "http";

const env = { account, region };
const iamAccount = account || cdk.Aws.ACCOUNT_ID;
const assumerRoleArn = `arn:aws:iam::${iamAccount}:role/spinnaker-assumer-role`;
const spinnakerLocalUserName = "spinnaker-local-user";
const spinnakerLocalUserArn = `arn:aws:iam::${iamAccount}:user/${spinnakerLocalUserName}`;
const assumerTrustedPrincipalArn =
  app.node.tryGetContext("spinnakerAssumerTrustedPrincipalArn") ||
  process.env.DXCP_SPINNAKER_ASSUMER_TRUSTED_PRINCIPAL_ARN;

const iamDevStack = new EnvIamStack(app, "dxcp-env-iam-dev", {
  env,
  environmentName: "dev",
  assumerRoleArn,
  additionalTrustedUserArn: spinnakerLocalUserArn,
});
const iamStagingStack = new EnvIamStack(app, "dxcp-env-iam-staging", {
  env,
  environmentName: "staging",
  assumerRoleArn,
  additionalTrustedUserArn: spinnakerLocalUserArn,
});
const iamProdStack = new EnvIamStack(app, "dxcp-env-iam-prod", {
  env,
  environmentName: "prod",
  assumerRoleArn,
  additionalTrustedUserArn: spinnakerLocalUserArn,
});

new EnvIamAssumerStack(app, "dxcp-env-iam-assumer", {
  env,
  trustedPrincipalArn: assumerTrustedPrincipalArn,
  localUserName: spinnakerLocalUserName,
  targetRoleArns: [
    iamDevStack.roleArn,
    iamStagingStack.roleArn,
    iamProdStack.roleArn,
  ],
});

new EnvVpcStack(app, "dxcp-env-vpc-dev", {
  env,
  environmentName: "dev",
  cidrBlock: "10.10.0.0/16",
});

new EnvVpcStack(app, "dxcp-env-vpc-staging", {
  env,
  environmentName: "staging",
  cidrBlock: "10.20.0.0/16",
});

new EnvVpcStack(app, "dxcp-env-vpc-prod", {
  env,
  environmentName: "prod",
  cidrBlock: "10.30.0.0/16",
});

new EnvDemoRuntimeStack(app, "dxcp-env-demo-runtime-dev", {
  env,
  environmentName: "dev",
});

new EnvDemoRuntimeStack(app, "dxcp-env-demo-runtime-staging", {
  env,
  environmentName: "staging",
});

new EnvDemoRuntimeStack(app, "dxcp-env-demo-runtime-prod", {
  env,
  environmentName: "prod",
});

const dataStack = new DataStack(app, "DxcpDataStack", {
  env,
  configPrefix,
  killSwitch,
  demoMode,
  apiToken,
  ciPublishers,
  readRpm,
  mutateRpm,
  dailyQuotaDeploy,
  dailyQuotaRollback,
  dailyQuotaBuildRegister,
  dailyQuotaUploadCapability,
});

const demoRuntimeStack = new DemoRuntimeStack(app, "DxcpDemoRuntimeStack", { env, configPrefix });

const apiStack = new ApiStack(app, "DxcpApiStack", {
  env,
  table: dataStack.table,
  configPrefix,
  corsOrigins: corsOriginsRaw.split(",").map((origin: string) => origin.trim()).filter(Boolean),
  spinnakerMode,
  artifactBucket: demoRuntimeStack.artifactBucket,
  engineTokenSecret: demoRuntimeStack.controllerTokenSecret,
});

new UiStack(app, "DxcpUiStack", { env, apiEndpoint: apiStack.apiEndpoint });
