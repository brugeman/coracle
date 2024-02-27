import {max, pluck} from "ramda"
import {batch, updateIn} from "hurdak"
import {Tags} from "paravel"
import {projections} from "src/engine/core/projections"
import type {Event} from "src/engine/events/model"
import {sessions} from "src/engine/session/state"
import {updateSession} from "src/engine/session/commands"
import {getNip04, getNip44, getNip59} from "src/engine/session/utils"
import {_events, deletes, seen} from "./state"

const getSession = pubkey => sessions.get()[pubkey]

projections.addGlobalHandler(
  batch(500, (chunk: Event[]) => {
    const $sessions = sessions.get()
    const userEvents = chunk.filter(e => $sessions[e.pubkey] && !e.wrap)

    if (userEvents.length > 0) {
      _events.update($events => $events.concat(userEvents))
    }
  }),
)

projections.addHandler(
  5,
  batch(500, (chunk: Event[]) => {
    const tags = Tags.fromEvent(chunk).filter(tag => ["a", "e"].includes(tag.key()))

    for (const pubkey of new Set(pluck("pubkey", chunk))) {
      updateSession(
        pubkey,
        updateIn("deletes_last_synced", t =>
          pluck("created_at", chunk)
            .concat(t || 0)
            .reduce(max, 0),
        ),
      )
    }

    deletes.update($deletes => {
      tags.forEach(t => $deletes.add(t.value()))

      return $deletes
    })
  }),
)

projections.addHandler(
  15,
  batch(500, (chunk: Event[]) => {
    for (const pubkey of new Set(pluck("pubkey", chunk))) {
      updateSession(
        pubkey,
        updateIn("seen_last_synced", t =>
          pluck("created_at", chunk)
            .concat(t || 0)
            .reduce(max, 0),
        ),
      )
    }

    seen.mapStore.update($m => {
      for (const e of chunk) {
        $m.set(e.id, e)
      }

      return $m
    })
  }),
)

const handleWrappedEvent = getEncryption => wrap => {
  const session = getSession(Tags.fromEvent(wrap).get("p").value())

  if (!session) {
    return
  }

  if (getEncryption(session).isEnabled()) {
    getNip59(session).withUnwrappedEvent(wrap, session.privkey, rumor => {
      projections.push(rumor)
    })
  }
}

projections.addHandler(1059, handleWrappedEvent(getNip44))
projections.addHandler(1060, handleWrappedEvent(getNip04))
