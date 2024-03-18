import {Collection, Writable} from "src/engine/core/utils"
import type {Event, ReadReceipt} from "./model"

export const _events = new Collection<Event>("id", 1000)
export const seen = new Collection<ReadReceipt>("id", 1000)
export const deletes = new Writable(new Set<string>(), 10000)
