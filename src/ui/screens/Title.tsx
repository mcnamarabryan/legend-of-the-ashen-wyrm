import type { HeaderCharacter, SlotSummary } from '../../api/wire';

/**
 * Title screen / character picker.
 *
 * Lists the characters the SERVER says exist in this realm. The client does not
 * know their stats — only what the realm was willing to say.
 */

export interface TitleProps {
  character: HeaderCharacter | null;
  slots: SlotSummary[];
}

export function Title({ character, slots }: TitleProps) {
  const currentKey = character ? character.name.trim().toLowerCase() : null;

  return (
    <div className="screen screen-title">
      <div className="title-art">
        <pre className="title-block t-bright" aria-hidden="true">{`
  ██▓     ▓█████   ▄████ ▓█████  ███▄    █ ▓█████▄
  ▓██▒     ▓█   ▀  ██▒ ▀█▒▓█   ▀  ██ ▀█   █ ▒██▀ ██▌
  ▒██░     ▒███   ▒██░▄▄▄░▒███   ▓██  ▀█ ██▒░██   █▌
  ▒██░     ▒▓█  ▄ ░▓█  ██▓▒▓█  ▄ ▓██▒  ▐▌██▒░▓█▄   ▌
  ░██████▒ ░▒████▒░▒▓███▀▒░▒████▒▒██░   ▓██░░▒████▓
  ░ ▒░▓  ░ ░░ ▒░ ░ ░▒   ▒ ░░ ▒░ ░░ ▒░   ▒ ▒  ▒▒▓  ▒
`}</pre>
        <div className="title-word t-bright">ASHEN WYRM</div>
        <div className="title-rule t-dim">{'─'.repeat(54)}</div>
        <div className="title-sub t-dim">BKM REALM NODE 01 · 2400 BAUD · 1 NODE</div>
      </div>

      <p className="title-tagline t-base">
        Ten turns a day. A forest full of monsters. One dragon at the end of it.
      </p>

      {slots.length > 0 && (
        <div className="title-roster">
          <div className="title-roster-head t-dim">
            {slots.length === 1 ? 'ONE CHARACTER ON THIS NODE' : 'CHARACTERS ON THIS NODE'}
          </div>
          {slots.slice(0, 9).map((s, i) => {
            const isCurrent = s.name.trim().toLowerCase() === currentKey;
            return (
              <div className={`title-roster-row ${isCurrent ? 'is-current' : ''}`} key={s.name}>
                <span className="t-bright">[{i + 1}]</span>{' '}
                <span className={isCurrent ? 't-bright' : 't-base'}>{s.name.padEnd(15)}</span>
                <span className="t-dim">
                  {s.className.padEnd(9)} lvl {s.levelRoman.padEnd(4)}{' '}
                  {s.retired ? 'retired' : s.title}
                </span>
                {s.retired && <span className="t-ghost"> retired</span>}
              </div>
            );
          })}
        </div>
      )}

      <div className="title-menu">
        <div className="title-option">
          <span className="t-bright">[N]</span> <span className="t-base">A new character</span>
        </div>
        {slots.length > 0 && (
          <div className="title-option">
            <span className="t-dim">[1-9]</span>{' '}
            <span className="t-dim">Load a character</span>
          </div>
        )}
      </div>

      <div className="title-footer t-dim">
        keyboard only · the realm is decided on the node, not in this tab
      </div>
    </div>
  );
}
