import { CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";

export interface ApiStackProps extends StackProps {
  table: dynamodb.ITable;
  configPrefix: string;
  corsOrigins: string[];
  spinnakerMode: string;
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const lambdaCodePath = path.join(__dirname, "..", "build", "api");

    const handler = new lambda.Function(this, "DxcpApiHandler", {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: "main.handler",
      code: lambda.Code.fromAsset(lambdaCodePath),
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        DXCP_DDB_TABLE: props.table.tableName,
        DXCP_SSM_PREFIX: props.configPrefix,
        DXCP_LAMBDA: "1",
        DXCP_SPINNAKER_MODE: props.spinnakerMode,
        DXCP_CORS_ORIGINS: props.corsOrigins.join(","),
      },
    });

    props.table.grantReadWriteData(handler);
    handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter", "ssm:GetParameters"],
        resources: [`arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter${props.configPrefix}/*`],
      })
    );

    const httpApi = new apigwv2.HttpApi(this, "DxcpHttpApi", {
      corsPreflight: {
        allowHeaders: ["*"],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowOrigins: props.corsOrigins,
      },
    });

    const integration = new integrations.HttpLambdaIntegration("DxcpIntegration", handler);
    httpApi.addRoutes({
      path: "/v1/{proxy+}",
      methods: [apigwv2.HttpMethod.ANY],
      integration,
    });
    httpApi.addRoutes({
      path: "/v1",
      methods: [apigwv2.HttpMethod.ANY],
      integration,
    });

    const stage = httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage | undefined;
    if (stage) {
      stage.defaultRouteSettings = {
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      };
    }

    new CfnOutput(this, "ApiBaseUrl", { value: `${httpApi.apiEndpoint}/v1` });
  }
}
