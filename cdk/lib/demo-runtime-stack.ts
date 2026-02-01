import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as path from "path";

export interface DemoRuntimeStackProps extends StackProps {
  configPrefix: string;
}

export class DemoRuntimeStack extends Stack {
  public readonly artifactBucket: s3.Bucket;
  public readonly secretsBucket: s3.Bucket;
  public readonly controllerTokenSecret: secretsmanager.Secret;
  constructor(scope: Construct, id: string, props: DemoRuntimeStackProps) {
    super(scope, id, props);

    const secretsBucket = new s3.Bucket(this, "DxcpSecretsBucket", {
      bucketName: `dxcp-secrets-${Stack.of(this).account}-${Stack.of(this).region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.secretsBucket = secretsBucket;

    const artifactBucket = new s3.Bucket(this, "DemoArtifactBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: Duration.days(14),
        },
      ],
    });
    this.artifactBucket = artifactBucket;

    const runtimeTable = new dynamodb.Table(this, "DxcpDemoRuntimeState", {
      tableName: "DxcpDemoRuntimeState",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const demoServiceFn = new lambda.Function(this, "DemoServiceFunction", {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: "lambda_handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "..", "demo-service")),
      memorySize: 256,
      timeout: Duration.seconds(10),
    });
    const demoServiceUrl = demoServiceFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });
    demoServiceFn.addPermission("DemoServiceFunctionUrlPublicPermission", {
      action: "lambda:InvokeFunctionUrl",
      principal: new iam.AnyPrincipal(),
      functionUrlAuthType: lambda.FunctionUrlAuthType.NONE,
    });
    demoServiceFn.addPermission("DemoServicePublicInvokePermission", {
      action: "lambda:InvokeFunction",
      principal: new iam.AnyPrincipal(),
    });

    const demoService2Fn = new lambda.Function(this, "DemoService2Function", {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: "lambda_handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "..", "demo-service-2")),
      memorySize: 256,
      timeout: Duration.seconds(10),
    });
    const demoService2Url = demoService2Fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });
    demoService2Fn.addPermission("DemoService2FunctionUrlPublicPermission", {
      action: "lambda:InvokeFunctionUrl",
      principal: new iam.AnyPrincipal(),
      functionUrlAuthType: lambda.FunctionUrlAuthType.NONE,
    });
    demoService2Fn.addPermission("DemoService2PublicInvokePermission", {
      action: "lambda:InvokeFunction",
      principal: new iam.AnyPrincipal(),
    });

    const controllerTokenParamName = `${props.configPrefix}/runtime/controller_token`;
    const controllerFn = new lambda.Function(this, "DemoRuntimeController", {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: "lambda_handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "..", "runtime-controller")),
      memorySize: 512,
      timeout: Duration.seconds(30),
      environment: {
        DXCP_RUNTIME_STATE_TABLE: runtimeTable.tableName,
        DXCP_RUNTIME_TOKEN_PARAM: controllerTokenParamName,
        DXCP_ARTIFACT_BUCKET: artifactBucket.bucketName,
        DEMO_SERVICE_FUNCTION_NAME: demoServiceFn.functionName,
        DEMO_SERVICE_2_FUNCTION_NAME: demoService2Fn.functionName,
      },
    });
    const controllerUrl = controllerFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    controllerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["lambda:UpdateFunctionCode"],
        resources: [demoServiceFn.functionArn, demoService2Fn.functionArn],
      })
    );
    controllerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [artifactBucket.arnForObjects("*")],
      })
    );
    runtimeTable.grantReadWriteData(controllerFn);

    new ssm.StringParameter(this, "DemoServiceUrlParam", {
      parameterName: `${props.configPrefix}/runtime/service_url/demo-service`,
      stringValue: demoServiceUrl.url,
    });

    new ssm.StringParameter(this, "DemoService2UrlParam", {
      parameterName: `${props.configPrefix}/runtime/service_url/demo-service-2`,
      stringValue: demoService2Url.url,
    });

    new ssm.StringParameter(this, "DemoArtifactBucketParam", {
      parameterName: `${props.configPrefix}/runtime/artifact_bucket`,
      stringValue: artifactBucket.bucketName,
    });

    new ssm.StringParameter(this, "DemoRuntimeControllerUrlParam", {
      parameterName: `${props.configPrefix}/runtime/controller_url`,
      stringValue: controllerUrl.url,
    });

    const controllerTokenSecret = new secretsmanager.Secret(this, "DemoRuntimeControllerTokenSecret", {
      generateSecretString: {
        passwordLength: 32,
        excludePunctuation: true,
      },
    });
    this.controllerTokenSecret = controllerTokenSecret;

    new ssm.StringParameter(this, "DemoRuntimeControllerTokenParam", {
      parameterName: controllerTokenParamName,
      stringValue: controllerTokenSecret.secretArn,
    });

    new ssm.StringParameter(this, "EngineLambdaUrlParam", {
      parameterName: `${props.configPrefix}/engine/lambda/url`,
      stringValue: controllerUrl.url,
    });

    new ssm.StringParameter(this, "EngineLambdaTokenParam", {
      parameterName: `${props.configPrefix}/engine/lambda/token`,
      stringValue: controllerTokenSecret.secretArn,
    });

    controllerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter${controllerTokenParamName}`,
        ],
      })
    );
    controllerTokenSecret.grantRead(controllerFn);

    new ssm.StringParameter(this, "SpinnakerSecretsBucketParam", {
      parameterName: `${props.configPrefix}/spinnaker/secrets_bucket`,
      stringValue: secretsBucket.bucketName,
    });
  }
}
