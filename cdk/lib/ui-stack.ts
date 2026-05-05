import * as cdk from "aws-cdk-lib";
import { CfnOutput, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";

export interface UiStackProps extends StackProps {
  apiEndpoint: string;
}

export class UiStack extends Stack {
  constructor(scope: Construct, id: string, props: UiStackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, "DxcpUiBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const oai = new cloudfront.OriginAccessIdentity(this, "DxcpOai");
    bucket.grantRead(oai);

    const apiDomainWithPort = cdk.Fn.select(2, cdk.Fn.split("/", props.apiEndpoint));
    const apiDomain = cdk.Fn.select(0, cdk.Fn.split(":", apiDomainWithPort));
    const spaRewriteFunction = new cloudfront.Function(this, "DxcpSpaRewriteFunction", {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri || "/";
  if (uri.startsWith("/v1")) {
    return request;
  }
  if (uri === "/" || !uri.includes(".")) {
    request.uri = "/index.html";
  }
  return request;
}
      `),
    });

    const distribution = new cloudfront.Distribution(this, "DxcpUiDistribution", {
      defaultBehavior: {
        origin: new origins.S3Origin(bucket, { originAccessIdentity: oai }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          {
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            function: spaRewriteFunction,
          },
        ],
      },
      additionalBehaviors: {
        "/v1": {
          origin: new origins.HttpOrigin(apiDomain),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        "/v1/*": {
          origin: new origins.HttpOrigin(apiDomain),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      defaultRootObject: "index.html",
    });

    new CfnOutput(this, "UiBucketName", { value: bucket.bucketName });
    new CfnOutput(this, "UiDistributionId", { value: distribution.distributionId });
    new CfnOutput(this, "UiUrl", { value: `https://${distribution.domainName}` });
  }
}
