import { CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import * as path from "path";

export interface EnvDemoRuntimeStackProps extends StackProps {
  environmentName: "dev" | "staging" | "prod";
}

export class EnvDemoRuntimeStack extends Stack {
  constructor(scope: Construct, id: string, props: EnvDemoRuntimeStackProps) {
    super(scope, id, props);

    const envName = props.environmentName;
    const functions = [
      {
        id: "DemoServiceFunction",
        outputPrefix: "DemoService",
        functionName: `demo-service-${envName}`,
        codeDir: "demo-service",
      },
      {
        id: "DemoService2Function",
        outputPrefix: "DemoService2",
        functionName: `demo-service-2-${envName}`,
        codeDir: "demo-service-2",
      },
    ] as const;

    for (const def of functions) {
      const fn = new lambda.Function(this, def.id, {
        functionName: def.functionName,
        runtime: lambda.Runtime.PYTHON_3_11,
        handler: "lambda_handler.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "..", "..", "..", def.codeDir)),
        memorySize: 256,
        timeout: Duration.seconds(10),
        environment: {
          DXCP_ENVIRONMENT: envName,
          DXCP_SERVICE_NAME: def.functionName,
        },
      });

      const functionUrl = fn.addFunctionUrl({
        authType: lambda.FunctionUrlAuthType.NONE,
      });

      fn.addPermission(`${def.id}FunctionUrlPublicPermission`, {
        action: "lambda:InvokeFunctionUrl",
        principal: new iam.AnyPrincipal(),
        functionUrlAuthType: lambda.FunctionUrlAuthType.NONE,
      });

      fn.addPermission(`${def.id}PublicInvokePermission`, {
        action: "lambda:InvokeFunction",
        principal: new iam.AnyPrincipal(),
      });

      new CfnOutput(this, `${def.outputPrefix}FunctionName`, { value: fn.functionName });
      new CfnOutput(this, `${def.outputPrefix}FunctionUrl`, { value: functionUrl.url });
    }
  }
}

