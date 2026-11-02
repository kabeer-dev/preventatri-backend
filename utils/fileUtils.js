const {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const {Upload} = require('@aws-sdk/lib-storage');
const {getSignedUrl} = require('@aws-sdk/s3-request-presigner');
const config = require('config');

const {FILE_NOT_FOUND, S3_KEY_PREFIXES} = require('../constants/file');
const {signedUrlExpireTimeInSeconds} = require('../constants/generalConstant');
const logger = require('../middleware/loggerMiddleware');

const accessKeyId = config.get('awsAccessKeyId');
const secretAccessKey = config.get('awsSecretAccessKey');
const Bucket = config.get('awsBucket');
const region = config.get('awsBucketRegion');

const client = new S3Client({
  region,
  credentials: {accessKeyId, secretAccessKey},
});

// Presigning is a local signing operation, not a network round trip.
async function buildSignedUrl({key}) {
  const command = new GetObjectCommand({Bucket, Key: key});

  return getSignedUrl(client, command, {
    expiresIn: signedUrlExpireTimeInSeconds,
  });
}

function isFileReference({value}) {
  if (!value || typeof value !== 'object' || typeof value.key !== 'string') {
    return false;
  }

  return S3_KEY_PREFIXES.some((prefix) => value.key.startsWith(`${prefix}/`));
}

// Walks an arbitrary response payload and collects every stored file reference
// ({url, key}), regardless of how deeply the owning factory nested it.
function collectFileReferences({value, references}) {
  if (Array.isArray(value)) {
    for (const item of value) collectFileReferences({value: item, references});

    return references;
  }

  if (!value || typeof value !== 'object') return references;

  if (isFileReference({value})) {
    references.push(value);

    return references;
  }

  for (const key of Object.keys(value)) {
    collectFileReferences({value: value[key], references});
  }

  return references;
}

module.exports.uploadFile = async ({file, fileDir}) => {
  try {
    const fileName = file.originalname;
    const fullKey = `${fileDir}/${fileName}`;

    const upload = new Upload({
      client,
      params: {
        Bucket,
        Key: fullKey,
        Body: file.buffer,

        // Without this S3 stores the object as application/octet-stream, which
        // makes browsers download the file instead of rendering it inline.
        ContentType: file.mimetype,
      },
    });

    const data = await upload.done();

    return {url: data.Location, key: fullKey};
  } catch (error) {
    logger.error(error);
    throw error;
  }
};

module.exports.deleteFile = async ({key}) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket,
      Key: key,
    });
    await client.send(command);

    return {key};
  } catch (error) {
    logger.error(error);
    throw error;
  }
};

module.exports.getFile = async ({key}) => {
  try {
    const command = new HeadObjectCommand({
      Bucket,
      Key: key,
    });
    await client.send(command); // Check if the file exists

    const url = await buildSignedUrl({key});

    return {url, key};
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return {url: null, key, error: FILE_NOT_FOUND};
    }
    throw error;
  }
};

// Replaces the `url` of every stored file reference in a response payload with
// a freshly presigned, expiring link. The permanent URL persisted at upload
// time is never served. Mutates the payload in place, which is safe because it
// is built per request by the response factories.
module.exports.signFileRefs = async ({payload}) => {
  const references = collectFileReferences({value: payload, references: []});

  if (!references.length) return payload;

  await Promise.all(
    references.map(async (reference) => {
      reference.url = await buildSignedUrl({key: reference.key});
    })
  );

  return payload;
};
