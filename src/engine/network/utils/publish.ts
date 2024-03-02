import EventEmitter from "events"
import {createEvent, Tags} from "paravel"
import {omit, uniqBy} from "ramda"
import {defer, union, difference} from "hurdak"
import {info} from "src/util/logger"
import {parseContent} from "src/util/notes"
import {getIdAndAddress} from "src/util/nostr"
import type {Event, NostrEvent} from "src/engine/events/model"
import {hints} from "src/engine/relays/utils"
import {env, pubkey} from "src/engine/session/state"
import {getSetting} from "src/engine/session/utils"
import {signer} from "src/engine/session/derived"
import {projections} from "src/engine/core/projections"
import {displayPubkey} from "src/engine/people/utils"
import {getUrls, getExecutor} from "./executor"

export const getClientTags = () => {
  if (!getSetting("enable_client_tag")) {
    return []
  }

  const {CLIENT_NAME = "", CLIENT_ID} = env.get()
  const tag = ["client", CLIENT_NAME]

  if (CLIENT_ID) {
    tag.push(CLIENT_ID)
  }

  return [tag]
}

export type PublisherOpts = {
  timeout?: number
  silent?: boolean
  verb?: string
}

export type StaticPublisherOpts = PublisherOpts & {
  event: NostrEvent
  relays?: string[]
}

export class Publisher extends EventEmitter {
  result = defer()
  event: Event

  constructor(event: NostrEvent) {
    super()

    if ((event as Event).wrap) {
      throw new Error("Can't publish unwrapped events")
    }

    this.event = {...event, seen_on: []}
  }

  static publish({event, relays, ...opts}: StaticPublisherOpts) {
    const publisher = new Publisher(event)

    publisher.publish(relays || hints.PublishEvent(event).getUrls(), opts)

    return publisher
  }

  publish(relays, {timeout = 10_000, verb, silent}: PublisherOpts = {}) {
    const urls = getUrls(relays)
    const executor = getExecutor(urls)

    if (!silent) {
      info(`Publishing to ${urls.length} relays`, this.event, urls)
    }

    const timeouts = new Set<string>()
    const succeeded = new Set<string>()
    const failed = new Set<string>()

    const getProgress = () => {
      const attempted = new Set(urls)
      const completed = union(timeouts, succeeded, failed)
      const pending = difference(attempted, completed)

      return {event: this.event, attempted, succeeded, failed, timeouts, completed, pending}
    }

    const attemptToResolve = () => {
      const progress = getProgress()

      if (progress.pending.size === 0) {
        sub.unsubscribe()
        executor.target.cleanup()
        this.result.resolve(progress)
      }

      this.emit("progress", progress)
    }

    // return

    projections.push({...this.event})

    setTimeout(() => {
      for (const url of urls) {
        if (!succeeded.has(url) && !failed.has(url)) {
          timeouts.add(url)
        }
      }

      attemptToResolve()
    }, timeout)

    const sub = executor.publish(omit(["seen_on"], this.event), {
      verb,
      onOk: (url: string, eventId: string, ok: boolean) => {
        this.event.seen_on.push(url)

        if (ok) {
          succeeded.add(url)
          failed.delete(url)
        } else {
          succeeded.delete(url)
          failed.add(url)
        }

        timeouts.delete(url)
        attemptToResolve()
      },
      onError: (url: string) => {
        failed.add(url)
        timeouts.delete(url)
        attemptToResolve()
      },
    })

    // Report progress to start with
    attemptToResolve()
  }
}

export type EventOpts = {
  created_at?: number
  content?: string
  tags?: string[][]
}

export type PublishOpts = EventOpts & {
  sk?: string
  relays?: string[]
}

export const publish = async (template, {sk, relays}: PublishOpts = {}) => {
  return Publisher.publish({
    timeout: 5000,
    relays: relays || hints.Outbox().getUrls(),
    event: sk
      ? await signer.get().signWithKey(template, sk)
      : await signer.get().signAsUser(template),
  })
}

export const createAndPublish = async (
  kind: number,
  {relays, sk, content = "", tags = []}: PublishOpts,
) => {
  const template = createEvent(kind, {
    content,
    tags: uniqTags([...tags, ...tagsFromContent(content)]),
  })

  return publish(template, {sk, relays})
}

export const uniqTags = uniqBy((t: string[]) =>
  t[0] === "param" ? t.join(":") : t.slice(0, 2).join(":"),
)

export const mention = (pubkey: string) =>
  hints.tagPubkey(pubkey).append(displayPubkey(pubkey)).valueOf()

export const tagsFromContent = (content: string) => {
  const tags = []

  for (const {type, value} of parseContent({content, tags: []})) {
    if (type === "topic") {
      tags.push(["t", value])
    }

    if (type.match(/nostr:(note|nevent)/)) {
      tags.push(["q", value.id, value.relays?.[0] || ""])
    }

    if (type.match(/nostr:(nprofile|npub)/)) {
      tags.push(mention(value.pubkey))
    }
  }

  return tags
}

export const getReplyTags = (parent: Event, inherit = false) => {
  const tags = Tags.fromEvent(parent)
  const replyTagValues = getIdAndAddress(parent)
  const userPubkey = pubkey.get()
  const replyTags = []

  // Mention the parent's author
  if (parent.pubkey !== userPubkey) {
    replyTags.push(hints.tagPubkey(parent.pubkey).valueOf())
  }

  // Inherit p-tag mentions
  if (inherit) {
    for (const pubkey of tags.values("p").valueOf()) {
      if (pubkey !== userPubkey) {
        replyTags.push(hints.tagPubkey(pubkey).valueOf())
      }
    }
  }

  // Based on NIP 10 legacy tags, order is root, mentions, reply
  const {roots, replies, mentions} = tags.ancestors()

  // Root comes first
  if (roots.exists()) {
    for (const t of roots.valueOf()) {
      replyTags.push(t.concat("root"))
    }
  } else {
    for (const t of replies.valueOf()) {
      replyTags.push(t.concat("root"))
    }
  }

  if (inherit) {
    // Make sure we don't repeat any tag values
    const isRepeated = v => replyTagValues.includes(v) || replyTags.find(t => t[1] === v)

    // Inherit mentions
    for (const t of mentions.valueOf()) {
      if (!isRepeated(t[1])) {
        replyTags.push(t.concat("mention"))
      }
    }

    // Inherit replies if they weren't already included
    if (roots.exists()) {
      for (const t of replies.valueOf()) {
        if (!isRepeated(t[1])) {
          replyTags.push(t.concat("mention"))
        }
      }
    }
  }

  // Add a/e-tags to the parent event
  for (const tag of hints.tagEvent(parent, "reply").valueOf()) {
    replyTags.push(tag)
  }

  return replyTags
}
