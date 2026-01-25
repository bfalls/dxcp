#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ApiStack } from "../lib/api-stack";
import { DataStack } from "../lib/data-stack";
import { SpinnakerStack } from "../lib/spinnaker-stack";
import { UiStack } from "../lib/ui-stack";

const app = new cdk.App();

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || "us-east-1";

const configPrefix = app.node.tryGetContext("configPrefix") || "/dxcp/config";
const killSwitch = app.node.tryGetContext("killSwitch") || process.env.DXCP_KILL_SWITCH || "0";
const demoMode = app.node.tryGetContext("demoMode") || process.env.DXCP_DEMO_MODE || "true";
const apiToken = app.node.tryGetContext("apiToken") || process.env.DXCP_API_TOKEN || "";
const readRpm = app.node.tryGetContext("readRpm") || process.env.DXCP_READ_RPM || "60";
const mutateRpm = app.node.tryGetContext("mutateRpm") || process.env.DXCP_MUTATE_RPM || "10";
const dailyQuotaDeploy = app.node.tryGetContext("dailyQuotaDeploy") || process.env.DXCP_DAILY_QUOTA_DEPLOY || "25";
const dailyQuotaRollback = app.node.tryGetContext("dailyQuotaRollback") || process.env.DXCP_DAILY_QUOTA_ROLLBACK || "10";
const dailyQuotaBuildRegister = app.node.tryGetContext("dailyQuotaBuildRegister") || process.env.DXCP_DAILY_QUOTA_BUILD_REGISTER || "50";
const dailyQuotaUploadCapability = app.node.tryGetContext("dailyQuotaUploadCapability") || process.env.DXCP_DAILY_QUOTA_UPLOAD_CAPABILITY || "50";
const corsOriginsRaw = app.node.tryGetContext("corsOrigins") || process.env.DXCP_CORS_ORIGINS || "*";
const spinnakerMode = app.node.tryGetContext("spinnakerMode") || process.env.DXCP_SPINNAKER_MODE || "stub";
const spinnakerIpMode = app.node.tryGetContext("spinnakerIpMode") || process.env.DXCP_SPINNAKER_IP_MODE || "eip";
const spinnakerAdminCidr = app.node.tryGetContext("spinnakerAdminCidr") || process.env.DXCP_SPINNAKER_ADMIN_CIDR || "";
const spinnakerInstanceType = app.node.tryGetContext("spinnakerInstanceType") || process.env.DXCP_SPINNAKER_INSTANCE_TYPE || "t3.small";
const spinnakerKeyName = app.node.tryGetContext("spinnakerKeyName") || process.env.DXCP_SPINNAKER_KEY_NAME || "";
const spinnakerGateImage =
  app.node.tryGetContext("spinnakerGateImage") ||
  process.env.DXCP_SPINNAKER_GATE_IMAGE ||
  "wwbgo/spinnaker:gate-1.20.0";
const dynuHostname = app.node.tryGetContext("dynuHostname") || process.env.DXCP_DYNU_HOSTNAME || "dxcp.ddnsfree.com";

const env = { account, region };

const dataStack = new DataStack(app, "DxcpDataStack", {
  env,
  configPrefix,
  killSwitch,
  demoMode,
  apiToken,
  readRpm,
  mutateRpm,
  dailyQuotaDeploy,
  dailyQuotaRollback,
  dailyQuotaBuildRegister,
  dailyQuotaUploadCapability,
});

new ApiStack(app, "DxcpApiStack", {
  env,
  table: dataStack.table,
  configPrefix,
  corsOrigins: corsOriginsRaw.split(",").map((origin: string) => origin.trim()).filter(Boolean),
  spinnakerMode,
});

new SpinnakerStack(app, "DxcpSpinnakerStack", {
  env,
  configPrefix,
  ipMode: spinnakerIpMode,
  adminCidr: spinnakerAdminCidr,
  instanceType: spinnakerInstanceType,
  dynuHostname,
  keyName: spinnakerKeyName || undefined,
  gateImage: spinnakerGateImage,
});

new UiStack(app, "DxcpUiStack", { env });
