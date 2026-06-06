import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
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

// 服务端直写对象（封面等小文件走服务端中转，免去浏览器直传的 CORS/签名负担）
export async function putObject(key: string, body: Uint8Array | string, contentType: string) {
  const { s3 } = useRuntimeConfig()
  await useS3().send(new PutObjectCommand({ Bucket: s3.bucket, Key: key, Body: body, ContentType: contentType }))
}

// 读回文本对象（CSV 回放走服务端代理，可见性鉴权在调用方）
export async function getObjectText(key: string): Promise<string> {
  const { s3 } = useRuntimeConfig()
  const res = await useS3().send(new GetObjectCommand({ Bucket: s3.bucket, Key: key }))
  return await res.Body!.transformToString()
}

// 读回二进制对象（封面图代理）
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const { s3 } = useRuntimeConfig()
  const res = await useS3().send(new GetObjectCommand({ Bucket: s3.bucket, Key: key }))
  return await res.Body!.transformToByteArray()
}

export async function deleteObject(key: string) {
  const { s3 } = useRuntimeConfig()
  await useS3().send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key }))
}
