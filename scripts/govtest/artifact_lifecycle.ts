import { CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { RunContext } from "./types.ts";
import { optionalEnv, requiredEnv } from "./common.ts";

const DEFAULT_ARTIFACT_KEY_TEMPLATE = "demo-service/demo-service-{version}.zip";

export type PreparedArtifact = {
  bucket: string;
  baselineKey: string;
  targetKey: string;
  runVersion: string;
  createdByPrep: boolean;
};

function logInfo(message: string): void {
  console.log(`[INFO] ${message}`);
}

function fail(message: string): never {
  throw new Error(message);
}

function parseS3Uri(uri: string): { bucket: string; key: string } {
  const trimmed = uri.trim();
  const match = trimmed.match(/^s3:\/\/([^/]+)\/(.+)$/i);
  if (!match) {
    fail(`Expected s3://bucket/key format, got: ${uri}`);
  }
  return {
    bucket: match[1],
    key: match[2],
  };
}

function renderArtifactKey(template: string, service: string, version: string): string {
  return template.replaceAll("{service}", service).replaceAll("{version}", version);
}

export function computeTargetArtifactKey(service: string, runVersion: string): string {
  const template = optionalEnv("GOV_ARTIFACT_KEY_TEMPLATE") ?? DEFAULT_ARTIFACT_KEY_TEMPLATE;
  return renderArtifactKey(template, service, runVersion);
}

async function objectExists(s3: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    const status = Number((error as any)?.$metadata?.httpStatusCode ?? 0);
    const code = String((error as any)?.name ?? "");
    if (status === 404 || code === "NotFound" || code === "NoSuchKey") {
      return false;
    }
    throw error;
  }
}

export async function ensureArtifactExists(
  s3: S3Client,
  bucket: string,
  baselineKey: string,
  targetKey: string,
): Promise<{ createdByPrep: boolean }> {
  const targetExists = await objectExists(s3, bucket, targetKey);
  if (targetExists) {
    logInfo(`Artifact prep: target already existed (s3://${bucket}/${targetKey})`);
    return { createdByPrep: false };
  }

  const baselineExists = await objectExists(s3, bucket, baselineKey);
  if (!baselineExists) {
    fail(`Artifact prep baseline missing: s3://${bucket}/${baselineKey}`);
  }

  const copySource = `${bucket}/${baselineKey}`;
  await s3.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: targetKey,
      CopySource: copySource,
    }),
  );

  const copied = await objectExists(s3, bucket, targetKey);
  if (!copied) {
    fail(`Artifact prep copy completed but target not found: s3://${bucket}/${targetKey}`);
  }
  logInfo(`Artifact prep: copied baseline to target (s3://${bucket}/${baselineKey} -> s3://${bucket}/${targetKey})`);
  return { createdByPrep: true };
}

export async function cleanupArtifact(
  s3: S3Client,
  bucket: string,
  targetKey: string,
  createdByPrep: boolean,
): Promise<void> {
  if (!createdByPrep) {
    logInfo(`Artifact cleanup: skipped delete because target was pre-existing (s3://${bucket}/${targetKey})`);
    return;
  }
  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: targetKey,
      }),
    );
    logInfo(`Artifact cleanup: deleted target (s3://${bucket}/${targetKey})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logInfo(`Artifact cleanup: FAILED to delete s3://${bucket}/${targetKey}; error=${message}`);
  }
}

function resolveArtifactLocation(context: RunContext): { bucket: string; baselineKey: string; targetKey: string } {
  const seedArtifactRef = context.discovered.seedArtifactRef;
  if (!seedArtifactRef) {
    fail("Artifact prep requires a discovered seedArtifactRef but none was found.");
  }
  const seed = parseS3Uri(seedArtifactRef);
  const artifactKeyTemplate = optionalEnv("GOV_ARTIFACT_KEY_TEMPLATE") ?? DEFAULT_ARTIFACT_KEY_TEMPLATE;
  const baselineVersion =
    optionalEnv("GOV_BASELINE_ARTIFACT_VERSION") ??
    optionalEnv("GOV_ARTIFACT_BASELINE_VERSION") ??
    context.discovered.seedVersion ??
    "0.1.18";
  const explicitBaselineRef = optionalEnv("GOV_ARTIFACT_BASELINE_REF");
  const targetKey = renderArtifactKey(artifactKeyTemplate, context.service, context.runVersion);

  let baselineKey = renderArtifactKey(artifactKeyTemplate, context.service, baselineVersion);
  if (explicitBaselineRef) {
    const parsedBaseline = parseS3Uri(explicitBaselineRef);
    if (parsedBaseline.bucket !== seed.bucket) {
      fail(
        `Artifact prep baseline bucket mismatch: seed bucket=${seed.bucket} baseline bucket=${parsedBaseline.bucket}. Cross-bucket copy is not supported in this harness.`,
      );
    }
    baselineKey = parsedBaseline.key;
  }
  return {
    bucket: seed.bucket,
    baselineKey,
    targetKey,
  };
}

export async function prepareRunArtifact(context: RunContext): Promise<PreparedArtifact> {
  const region = requiredEnv("GOV_AWS_REGION");
  const s3 = new S3Client({ region });
  const { bucket, baselineKey, targetKey } = resolveArtifactLocation(context);
  const prepMode = (optionalEnv("GOV_ARTIFACT_PREP_MODE") ?? "reuse-baseline").toLowerCase();
  logInfo(
    `Artifact prep plan: runVersion=${context.runVersion} baselineKey=s3://${bucket}/${baselineKey} targetKey=s3://${bucket}/${targetKey}`,
  );
  if (prepMode === "reuse-baseline") {
    const baselineExists = await objectExists(s3, bucket, baselineKey);
    if (!baselineExists) {
      fail(`Artifact prep baseline missing: s3://${bucket}/${baselineKey}`);
    }
    const baselineRef = `s3://${bucket}/${baselineKey}`;
    process.env.GOV_PREPARED_ARTIFACT_REF = baselineRef;
    logInfo(`Artifact prep: reuse-baseline mode active; using ${baselineRef} for build registration/deploy.`);
    return {
      bucket,
      baselineKey,
      targetKey: baselineKey,
      runVersion: context.runVersion,
      createdByPrep: false,
    };
  }
  const result = await ensureArtifactExists(s3, bucket, baselineKey, targetKey);
  process.env.GOV_PREPARED_ARTIFACT_REF = `s3://${bucket}/${targetKey}`;
  return {
    bucket,
    baselineKey,
    targetKey,
    runVersion: context.runVersion,
    createdByPrep: result.createdByPrep,
  };
}

export async function cleanupPreparedArtifact(prepared: PreparedArtifact): Promise<void> {
  const region = requiredEnv("GOV_AWS_REGION");
  const s3 = new S3Client({ region });
  await cleanupArtifact(s3, prepared.bucket, prepared.targetKey, prepared.createdByPrep);
}
