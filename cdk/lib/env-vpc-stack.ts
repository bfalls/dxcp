import { CfnOutput, Fn, Stack, StackProps, Tags } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export interface EnvVpcStackProps extends StackProps {
  cidrBlock: string;
  environmentName: string;
}

export class EnvVpcStack extends Stack {
  public readonly vpcId: string;
  public readonly publicSubnetIds: string[];

  constructor(scope: Construct, id: string, props: EnvVpcStackProps) {
    super(scope, id, props);

    const vpc = new ec2.CfnVPC(this, "EnvVpc", {
      cidrBlock: props.cidrBlock,
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });
    Tags.of(vpc).add("Name", id);
    Tags.of(vpc).add("dxcp:environment", props.environmentName);

    const internetGateway = new ec2.CfnInternetGateway(this, "EnvVpcInternetGateway", {});
    const gatewayAttachment = new ec2.CfnVPCGatewayAttachment(this, "EnvVpcGatewayAttachment", {
      vpcId: vpc.ref,
      internetGatewayId: internetGateway.ref,
    });

    const subnetCidrs = Fn.cidr(props.cidrBlock, 4, "8");
    const subnetA = new ec2.CfnSubnet(this, "PublicSubnetA", {
      vpcId: vpc.ref,
      cidrBlock: Fn.select(0, subnetCidrs),
      availabilityZone: Fn.select(0, Fn.getAzs()),
      mapPublicIpOnLaunch: true,
    });
    const subnetB = new ec2.CfnSubnet(this, "PublicSubnetB", {
      vpcId: vpc.ref,
      cidrBlock: Fn.select(1, subnetCidrs),
      availabilityZone: Fn.select(1, Fn.getAzs()),
      mapPublicIpOnLaunch: true,
    });
    Tags.of(subnetA).add("Name", `${id}-public-a`);
    Tags.of(subnetB).add("Name", `${id}-public-b`);

    const publicRouteTable = new ec2.CfnRouteTable(this, "PublicRouteTable", {
      vpcId: vpc.ref,
    });
    const defaultRoute = new ec2.CfnRoute(this, "DefaultInternetRoute", {
      routeTableId: publicRouteTable.ref,
      destinationCidrBlock: "0.0.0.0/0",
      gatewayId: internetGateway.ref,
    });
    defaultRoute.addDependency(gatewayAttachment);

    new ec2.CfnSubnetRouteTableAssociation(this, "PublicSubnetARouteTableAssociation", {
      subnetId: subnetA.ref,
      routeTableId: publicRouteTable.ref,
    });
    new ec2.CfnSubnetRouteTableAssociation(this, "PublicSubnetBRouteTableAssociation", {
      subnetId: subnetB.ref,
      routeTableId: publicRouteTable.ref,
    });

    this.vpcId = vpc.ref;
    this.publicSubnetIds = [subnetA.ref, subnetB.ref];

    new CfnOutput(this, "VpcId", { value: this.vpcId });
    new CfnOutput(this, "PublicSubnetIds", { value: Fn.join(",", this.publicSubnetIds) });
    new CfnOutput(this, "VpcCidr", { value: props.cidrBlock });
    new CfnOutput(this, "EnvironmentName", { value: props.environmentName });
  }
}
