import * as cdk from 'aws-cdk-lib';
import path = require('path');
import { Construct } from 'constructs';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Bucket, EventType } from 'aws-cdk-lib/aws-s3';
import { Code, Runtime, LayerVersion, Architecture } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { SqsDestination } from 'aws-cdk-lib/aws-s3-notifications';
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

export class AwsSqsThumbnailGeneratorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucket = new Bucket(this, 'AwsSqsThumbnailGeneratorBucket', {
      bucketName: 'sqs-thumbnail-generator-bucket',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true
    });

    const dlq = new Queue(this, 'AwsSqsThumbnailGeneratorDeadLetterQueue', {
      queueName: 'thumbnail-generator-dlq',
      retentionPeriod: cdk.Duration.days(1)
    });

    const queue = new Queue(this, 'AwsSqsThumbnailGeneratorQueue', {
      queueName: 'thumbnail-generator-queue',
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3
      } 
    });

    queue.addToResourcePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      principals: [new ServicePrincipal('s3.amazonaws.com')],
      actions: ['sqs:SendMessage'],
      resources: [queue.queueArn],
      conditions: {
        ArnLike: {
          'aws:SourceArn': bucket.bucketArn,
        },
      },
    }));

    bucket.addEventNotification(
      EventType.OBJECT_CREATED, 
      new SqsDestination(queue), 
      {prefix: 'uploads/'}
    );

    const sharpLayer = new LayerVersion(this, 'SharpLayer', {
      code: Code.fromAsset(path.join(__dirname, './layers/sharp.zip')),
      compatibleRuntimes: [Runtime.NODEJS_LATEST],
      compatibleArchitectures: [Architecture.ARM_64]
    });

    const generator = new NodejsFunction(this, 'AwsSqsThumbnailGeneratorProcessor', {
      functionName: 'thumbnail-generator-processor',
      runtime: Runtime.NODEJS_LATEST,
      handler: 'handler',
      entry: path.join(__dirname, './functions/thumbnail-generator.ts'),
      layers: [sharpLayer],
      architecture: Architecture.ARM_64,
      timeout: cdk.Duration.seconds(60),
      environment: {
        QUEUE_URL: queue.queueUrl
      }
    });

    generator.addEventSource(new SqsEventSource(queue));

    bucket.grantReadWrite(generator);
    queue.grantConsumeMessages(generator);  
  }
}
