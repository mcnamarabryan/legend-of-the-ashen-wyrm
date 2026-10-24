import type { CombatLine } from '../api/types';
import type {
  HeaderCharacter,
  MenuEntry,
  Screen,
  SlotSummary,
  WireEntry,
  WirePrompt,
} from '../api/wire';

/**
 * The client's view model.
 *
 * Note what is NOT here: characters with stats, monsters, XP, items, saves.
 * The client holds a rendered screen, a scrolling log, and a connection
 * status. It cannot compute a fight because it has nothing to compute with.
 */

export type Connection = 'connecting' | 'online' | 'offline';

export interface ClientLine extends CombatLine {
  /** Assigned client-side purely for React keys and typewriter tracking. */
  id: number;
}

export interface ClientState {
  connection: Connection;
  error: string | null;

  view: string;
  character: HeaderCharacter | null;
  prompt: WirePrompt | null;
  menu: MenuEntry[] | null;
  /** Live text entry, or null when no field is being filled in. */
  entry: WireEntry | null;
  slots: SlotSummary[];
  feed: string[];

  log: ClientLine[];
  /** Highest line id in the log — the typewriter's high-water mark. */
  topId: number;
  /** True while a request is in flight; input is ignored. */
  busy: boolean;
}

export type ClientAction =
  | { type: 'connecting' }
  | { type: 'offline'; error: string }
  | { type: 'screen'; screen: Screen }
  | { type: 'busy'; busy: boolean }
  | { type: 'clear-log' };

export const initialClientState: ClientState = {
  connection: 'connecting',
  error: null,
  view: 'boot',
  character: null,
  prompt: null,
  menu: null,
  entry: null,
  slots: [],
  feed: [],
  log: [],
  topId: 0,
  busy: false,
};

const MAX_LOG = 240;

export function clientReducer(state: ClientState, action: ClientAction): ClientState {
  switch (action.type) {
    case 'connecting':
      return { ...state, connection: 'connecting', error: null };

    case 'offline':
      return { ...state, connection: 'offline', error: action.error, busy: false };

    case 'busy':
      return { ...state, busy: action.busy };

    case 'clear-log':
      return { ...state, log: [] };

    case 'screen': {
      const { screen } = action;

      /* Number incoming lines so the typewriter knows what is new. The server
         never sends ids; bookkeeping is a presentation concern. */
      let id = state.topId;
      const incoming = screen.lines.map((l) => ({ ...l, id: ++id }));
      const log = incoming.length > 0 ? [...state.log, ...incoming].slice(-MAX_LOG) : state.log;

      return {
        ...state,
        connection: 'online',
        error: null,
        busy: false,
        view: screen.view,
        character: screen.character,
        prompt: screen.prompt,
        menu: screen.menu,
        entry: screen.entry,
        slots: screen.slots,
        feed: screen.feed,
        log,
        topId: id,
      };
    }

    default:
      return state;
  }
}
