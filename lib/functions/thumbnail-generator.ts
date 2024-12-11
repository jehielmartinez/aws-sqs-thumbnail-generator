import { Handler } from 'aws-lambda';
import { S3, SQS } from 'aws-sdk';
import sharp from 'sharp';

const s3 = new S3();
const sqs = new SQS();

const THUMBNAIL_WIDTHS = [
  { width: 50, name: 'small' },
  { width: 150, name: 'medium' },
  { width: 300, name: 'large' },
];

export const handler: Handler = async (event) => {
  const record = event.Records[0];
  const body = record.body;
  try {
    const message = JSON.parse(body).Records[0];
    const bucket = message.s3.bucket.name;
    const key = message.s3.object.key;
    const filename = key.split('/').pop();

    // Download image from S3
    const image = await s3.getObject({ Bucket: bucket, Key: key }).promise();

    // Generate thumbnails
    const thumbnailPromises = THUMBNAIL_WIDTHS.map(async (size) => {
      const resizedImage = await sharp(image.Body as Buffer)
        .resize(size.width, null, { 
          fit: 'contain',
          withoutEnlargement: true
        })
        .toBuffer();

      const thumbnailKey = `thumbnails/${size.name}/${filename}`;

      // Upload thumbnail to S3
      await s3.putObject({
        Bucket: bucket,
        Key: thumbnailKey,
        Body: resizedImage,
        ContentType: 'image/jpeg'
      }).promise();

      return thumbnailKey;
    });

    await Promise.all(thumbnailPromises);

    // Delete SQS message after successful processing
    await sqs.deleteMessage({
      QueueUrl: process.env.QUEUE_URL!,
      ReceiptHandle: record.receiptHandle
    }).promise();

    console.log(`Successfully processed image: ${key}`);
    return;
  } catch (error) {
    console.error(`Error processing message: ${error}`);
    throw error;
  }
};
