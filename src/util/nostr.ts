import {fromNostrURI, getAddress, Tags} from "paravel"
import {schnorr} from "@noble/curves/secp256k1"
import {bytesToHex} from "@noble/hashes/utils"
import {nip05, nip19, generateSecretKey, getEventHash, getPublicKey as getPk} from "nostr-tools"
import {pick, identity} from "ramda"
import {between, avg} from "hurdak"
import type {Event} from "src/engine"

export const fromHex = k => Uint8Array.from(Buffer.from(k, "hex"))
export const getPublicKey = (sk: string) => getPk(fromHex(sk))
export const generatePrivateKey = () => Buffer.from(generateSecretKey()).toString("hex")
export const getSignature = (e, sk: string) => bytesToHex(schnorr.sign(getEventHash(e), sk))
export const nsecEncode = (sk: string) => nip19.nsecEncode(Uint8Array.from(Buffer.from(sk, "hex")))

export const isKeyValid = (key: string) => {
  // Validate the key before setting it to state by encoding it using bech32.
  // This will error if invalid (this works whether it's a public or a private key)
  try {
    getPublicKey(key)
  } catch (e) {
    return false
  }

  return true
}

export const noteKinds = [1, 30023, 9802, 1808, 32123, 31923, 30402]
export const personKinds = [0, 2, 3, 10000, 10002]
export const reactionKinds = [7, 9735]
export const repostKinds = [6, 16]
export const userKinds = [...personKinds, 30001, 30003, 30078, 10004]

export const LOCAL_RELAY_URL = "local://coracle.relay"

export const appDataKeys = {
  USER_SETTINGS: "nostr-engine/User/settings/v1",
  NIP24_LAST_CHECKED: "nostr-engine/Nip24/last_checked/v1",
}

export const isLike = (e: Event) =>
  e.kind === 7 &&
  ["", "+", "🤙", "👍", "❤️", "😎", "🏅", "🫂", "🤣", "😂", "💜", "🔥"].includes(e.content)

export const asNostrEvent = e =>
  pick(["content", "created_at", "id", "kind", "pubkey", "sig", "tags"], e) as Event

export const toHex = (data: string): string | null => {
  if (data.match(/[a-zA-Z0-9]{64}/)) {
    return data
  }

  try {
    let key = nip19.decode(data).data

    if (key instanceof Uint8Array) {
      key = Buffer.from(key).toString("hex")
    }

    return key as string
  } catch (e) {
    return null
  }
}

export const getRating = (event: Event) =>
  parseInt(
    Tags.fromEvent(event)
      .whereKey("rating")
      .filter(t => t.count() === 2)
      .first()
      .value(),
  )

export const getAvgRating = (events: Event[]) => avg(events.map(getRating).filter(identity))

export const isHex = x => x?.match(/^[a-f0-9]{64}$/)

export const isReplaceable = e => between(9999, 20000, e.kind)

export const isParameterizedReplaceable = e => between(29999, 40000, e.kind)

export const isAddressable = e => isReplaceable(e) || isParameterizedReplaceable(e)

export const getIdOrAddress = e => (isAddressable(e) ? getAddress(e) : e.id)

export const getIdAndAddress = e => (isAddressable(e) ? [e.id, getAddress(e)] : [e.id])

export const isChildOf = (a, b) => {
  const {roots, replies} = Tags.fromEvent(a).ancestors()
  const parentIds = (replies.exists() ? replies : roots).values().valueOf()

  return Boolean(getIdAndAddress(b).find(x => parentIds.includes(x)))
}

const WARN_TAGS = new Set([
  "nsfw",
  "nude",
  "nudity",
  "porn",
  "ass",
  "boob",
  "boobstr",
  "sex",
  "sexy",
  "fuck",
])

export const getContentWarning = e => {
  const tags = Tags.fromEvent(e)
  const warning = tags.get("content-warning")?.value()

  if (warning) {
    return warning
  }

  return tags.topics().find(t => WARN_TAGS.has(t.toLowerCase()))
}

export const isGiftWrap = e => [1059, 1060].includes(e.kind)

export const parseAnything = async entity => {
  entity = fromNostrURI(entity)

  if (isHex(entity)) {
    return {type: "npub", data: entity}
  }

  if (entity.includes("@")) {
    const profile = await nip05.queryProfile(entity)

    if (profile) {
      return {type: "npub", data: profile.pubkey}
    }
  }
}
