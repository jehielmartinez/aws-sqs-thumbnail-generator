import { Handler, SQSEvent, SQSRecord } from 'aws-lambda';
import { S3, SQS } from 'aws-sdk';
import sharp from 'sharp';

interface ThumbnailConfig {
  width: number;
  name: string;
}

interface S3EventMessage {
  Records: Array<{
    s3: {
      bucket: { name: string };
      object: { key: string };
    };
  }>;
}

const THUMBNAIL_CONFIGS: ThumbnailConfig[] = [
  { width: 50, name: 'small' },
  { width: 150, name: 'medium' },
  { width: 300, name: 'large' },
] as const;

const s3Client = new S3();
const sqsClient = new SQS();

async function downloadImage(bucket: string, key: string): Promise<Buffer> {
  const image = await s3Client.getObject({ Bucket: bucket, Key: key }).promise();
  return image.Body as Buffer;
}

async function generateThumbnail(
  imageBuffer: Buffer,
  width: number
): Promise<Buffer> {
  return sharp(imageBuffer)
    .resize(width, null, { 
      fit: 'contain',
      withoutEnlargement: true 
    })
    .toBuffer();
}

async function uploadThumbnail(
  bucket: string,
  key: string,
  buffer: Buffer
): Promise<void> {
  await s3Client.putObject({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: 'image/jpeg'
  }).promise();
}

async function processImage(
  bucket: string,
  key: string,
  imageBuffer: Buffer
): Promise<string[]> {
  const filename = key.split('/').pop() as string;
  
  return Promise.all(
    THUMBNAIL_CONFIGS.map(async (config) => {
      const thumbnailBuffer = await generateThumbnail(imageBuffer, config.width);
      const thumbnailKey = `thumbnails/${config.name}/${filename}`;
      
      await uploadThumbnail(bucket, thumbnailKey, thumbnailBuffer);
      return thumbnailKey;
    })
  );
}

async function deleteSQSMessage(record: SQSRecord): Promise<void> {
  await sqsClient.deleteMessage({
    QueueUrl: process.env.QUEUE_URL!,
    ReceiptHandle: record.receiptHandle
  }).promise();
}

export const handler: Handler<SQSEvent> = async (event) => {
  const record = event.Records[0];
  
  try {
    const message = JSON.parse(record.body) as S3EventMessage;
    const { bucket: { name: bucketName }, object: { key } } = message.Records[0].s3;

    const imageBuffer = await downloadImage(bucketName, key);
    const thumbnailKeys = await processImage(bucketName, key, imageBuffer);
    await deleteSQSMessage(record);

    console.log({
      message: 'Successfully processed image',
      image: key,
      thumbnails: thumbnailKeys
    });
    return thumbnailKeys;
  } catch (error) {
    console.error({
      message: 'Error processing image',
      error: error instanceof Error ? error.message : 'Unknown error',
      record: record.body
    });
    throw error;
  }
};
