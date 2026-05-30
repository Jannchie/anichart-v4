import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

let _s3: S3Client | undefined

export function useS3() {
  if (!_s3) {
    const { s3 } = useRuntimeConfig()
    _s3 = new S3Client({
      endpoint: s3.endpoint,
      region: s3.region,
      credentials: {
        accessKeyId: s3.accessKeyId,
        secretAccessKey: s3.secretAccessKey,
      },
      forcePathStyle: true, // R2 / MinIO 通常需要
    })
  }
  return _s3
}

// 生成预签名 PUT URL，供浏览器直传数据文件，绕过服务端中转
export function presignUpload(key: string, contentType: string, expiresIn = 600) {
  const { s3 } = useRuntimeConfig()
  return getSignedUrl(
    useS3(),
    new PutObjectCommand({ Bucket: s3.bucket, Key: key, ContentType: contentType }),
    { expiresIn },
  )
}
