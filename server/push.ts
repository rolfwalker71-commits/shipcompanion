import webpush from 'web-push'
import { readJsonSync, writeJson } from './persist.ts'

type PushSub = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

type VapidFile = { publicKey: string; privateKey: string }

let vapid = readJsonSync<VapidFile | null>('vapid.json', null)
if (!vapid?.publicKey || !vapid.privateKey) {
  vapid = webpush.generateVAPIDKeys()
  void writeJson('vapid.json', vapid)
}

const subject = process.env.VAPID_MAILTO?.trim() || 'mailto:family@localhost'
webpush.setVapidDetails(subject, vapid.publicKey, vapid.privateKey)

let subs = readJsonSync<PushSub[]>('push-subs.json', []).filter((row) => row?.endpoint && row.keys?.p256dh)

export function pushPublicKey(): string {
  return vapid?.publicKey ?? ''
}

export async function savePushSub(sub: PushSub): Promise<void> {
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return
  subs = [sub, ...subs.filter((row) => row.endpoint !== sub.endpoint)]
  await writeJson('push-subs.json', subs)
}

export async function removePushSub(endpoint: string): Promise<void> {
  subs = subs.filter((row) => row.endpoint !== endpoint)
  await writeJson('push-subs.json', subs)
}

export async function notifyFamily(title: string, body: string, url = '/', tag = 'cruise-family'): Promise<void> {
  if (!subs.length) return
  const payload = JSON.stringify({ title, body, url, tag })
  const kept: PushSub[] = []
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload)
        kept.push(sub)
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode
        if (status !== 404 && status !== 410) kept.push(sub)
      }
    }),
  )
  if (kept.length !== subs.length) {
    subs = kept
    await writeJson('push-subs.json', subs)
  }
}
