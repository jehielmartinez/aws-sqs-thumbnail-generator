import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as AwsSqsThumbnailGenerator from '../lib/aws-sqs-thumbnail-generator-stack';

describe('AWS SQS Thumbnail Generator Infrastructure', () => {
  let app: cdk.App;
  let stack: AwsSqsThumbnailGenerator.AwsSqsThumbnailGeneratorStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new AwsSqsThumbnailGenerator.AwsSqsThumbnailGeneratorStack(app, 'TestStack');
    template = Template.fromStack(stack);
  });

  test('SQS Queue is created with correct properties', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'thumbnail-generator-queue',
      VisibilityTimeout: 60,
      RedrivePolicy: {
        deadLetterTargetArn: {
          'Fn::GetAtt': Match.arrayWith(['AwsSqsThumbnailGeneratorDeadLetterQueueD247DE1C', 'Arn']),
        },
        maxReceiveCount: 3,
      },
    });
  });

  test('Dead Letter Queue is created', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'thumbnail-generator-dlq',
      MessageRetentionPeriod: 1209600,
    });
  });

  test('S3 Bucket is created with correct configurations', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'sqs-thumbnail-generator-bucket',
      VersioningConfiguration: {
        Status: 'Enabled'
      }
    });

    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Delete',
      UpdateReplacePolicy: 'Delete'
    });
  });

  test('Processor Lambda function is created with correct configuration', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'thumbnail-generator-processor',
      Handler: 'index.handler',
      Runtime: 'nodejs18.x',
      Architectures: ['arm64'],
      Timeout: 60,
      Environment: {
        Variables: {
          QUEUE_URL: Match.objectLike({
            Ref: Match.stringLikeRegexp('.*Queue.*')
          })
        }
      }
    });
  });

  test('Lambda function has necessary IAM permissions', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [{
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: {
            Service: 'lambda.amazonaws.com'
          }
        }]
      }
    });

    template.hasResourceProperties('AWS::IAM::Policy', Match.objectLike({
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'sqs:ReceiveMessage',
              'sqs:ChangeMessageVisibility',
              'sqs:GetQueueUrl',
              'sqs:DeleteMessage',
              'sqs:GetQueueAttributes'
            ]),
            Effect: 'Allow'
          }),
          Match.objectLike({
            Action: Match.arrayWith([
              's3:GetObject*',
              's3:GetBucket*',
              's3:List*',
              's3:DeleteObject*',
              's3:PutObject',
              's3:Abort*'
            ]),
            Effect: 'Allow'
          })
        ])
      }
    }));
  });

  test('S3 bucket has SQS notification configured', () => {
    template.hasResourceProperties('Custom::S3BucketNotifications', {
      NotificationConfiguration: {
        QueueConfigurations: [{
          Events: ['s3:ObjectCreated:*'],
          Filter: {
            Key: {
              FilterRules: [{
                Name: 'prefix',
                Value: 'uploads/'
              }]
            }
          }
        }]
      }
    });
  });
});
