import { CfnOutput, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ssm from "aws-cdk-lib/aws-ssm";

export interface DataStackProps extends StackProps {
  configPrefix: string;
  killSwitch: string;
  demoMode: string;
  apiToken: string;
  ciPublishers: string;
  readRpm: string;
  mutateRpm: string;
  dailyQuotaDeploy: string;
  dailyQuotaRollback: string;
  dailyQuotaBuildRegister: string;
  dailyQuotaUploadCapability: string;
}

export class DataStack extends Stack {
  public readonly table: dynamodb.Table;
  public readonly configPrefix: string;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    this.configPrefix = props.configPrefix;

    this.table = new dynamodb.Table(this, "DxcpTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const param = (name: string, value: string) => {
      new ssm.StringParameter(this, `Param${name}`, {
        parameterName: `${props.configPrefix}/${name}`,
        stringValue: value,
      });
    };

    param("kill_switch", props.killSwitch);
    param("demo_mode", props.demoMode);
    if (props.apiToken.trim().length > 0) {
      param("api_token", props.apiToken);
    }
    param("ci_publishers", props.ciPublishers);
    param("read_rpm", props.readRpm);
    param("mutate_rpm", props.mutateRpm);
    param("daily_quota_deploy", props.dailyQuotaDeploy);
    param("daily_quota_rollback", props.dailyQuotaRollback);
    param("daily_quota_build_register", props.dailyQuotaBuildRegister);
    param("daily_quota_upload_capability", props.dailyQuotaUploadCapability);

    new CfnOutput(this, "DxcpTableName", { value: this.table.tableName });
  }
}
