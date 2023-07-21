import type {Env} from "./types"
import {Alerts} from "./components/Alerts"
import {Builder} from "./components/Builder"
import {Content} from "./components/Content"
import {Crypt} from "./components/Crypt"
import {Directory} from "./components/Directory"
import {Events} from "./components/Events"
import {Keys} from "./components/Keys"
import {Meta} from "./components/Meta"
import {Network} from "./components/Network"
import {Nip02} from "./components/Nip02"
import {Nip04} from "./components/Nip04"
import {Nip05} from "./components/Nip05"
import {Nip28} from "./components/Nip28"
import {Nip57} from "./components/Nip57"
import {Nip65} from "./components/Nip65"
import {Outbox} from "./components/Outbox"
import {PubkeyLoader} from "./components/PubkeyLoader"
import {Storage} from "./components/Storage"
import {User} from "./components/User"

export class Engine {
  Env: Env
  components = {
    Alerts: new Alerts(),
    Builder: new Builder(),
    Content: new Content(),
    Crypt: new Crypt(),
    Directory: new Directory(),
    Events: new Events(),
    Keys: new Keys(),
    Meta: new Meta(),
    Network: new Network(),
    Nip02: new Nip02(),
    Nip04: new Nip04(),
    Nip05: new Nip05(),
    Nip28: new Nip28(),
    Nip57: new Nip57(),
    Nip65: new Nip65(),
    Outbox: new Outbox(),
    PubkeyLoader: new PubkeyLoader(),
    Storage: new Storage(),
    User: new User(),
  }

  constructor(Env: Env) {
    this.Env = Env

    for (const component of Object.values(this.components)) {
      component.initialize?.(this)
    }
  }
}
