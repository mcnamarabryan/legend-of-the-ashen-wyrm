/**
 * All player-facing prose. Terse, second person, present tense.
 * Dry humor. Never winking at the player.
 */

export const boot = {
  lines: [
    'BKM REALM NODE 01 ........................ READY',
    '2400 BAUD ................................. OK',
    'CARRIER DETECT ............................ OK',
    'LOADING WYRM.SYS .......................... OK',
  ],
  art: [
    '  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄  ',
    '  █                                                 █  ',
    '  █    L E G E N D   O F   T H E                    █  ',
    '  █        A S H E N   W Y R M                      █  ',
    '  █                                                 █  ',
    '  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀  ',
  ],
  footer: '(c) a new realm. type ? for help.',
  askName: 'WHAT IS YOUR NAME?',
  reconnecting: 'CARRIER RE-ESTABLISHED .................... OK',
};

export const title = {
  banner: 'LEGEND OF THE ASHEN WYRM',
  sub: 'BKM REALM NODE 01',
  menu: ['[N] — A new name for the realm', '[C] — Continue where you left off'],
  tagline: 'Ten turns a day. A forest full of monsters. One dragon at the end of it.',
};

export const create = {
  nameTaken: 'That name is already known on this node. The realm remembers.',
  nameInvalid: 'Three to sixteen characters. Letters, apostrophes, spaces, hyphens.',
  askSex: 'And how shall the realm address you?',
  sexOptions: ['[M] — as a man', '[F] — as a woman'],
  askClass: 'Every road out of this town goes through the forest.',
  classOptions: ['[W] — Warrior', '[M] — Magician', '[T] — Thief'],
  classDesc: {
    warrior:
      'Highest health, heaviest swing. A warrior has no spells and does not need them. Probably.',
    magician:
      'Fragile, and aware of it. Wins with fire, sleep, and the sort of charm that opens doors.',
    thief: 'Fast, evasive, and professionally light-fingered. Can steal in town and in the dark.',
  },
  confirm: (name: string, cls: string) =>
    `{bright}${name}{/} the ${cls}. The innkeeper writes it in the ledger.`,
  welcome: [
    'You arrive at Redgate with a rusty dagger, rags, and fifty gold.',
    'Nobody here has heard of you. That is the point of arriving.',
    '{dim}Ten turns a day. Spend them in the forest or spend them in the inn.{/}',
  ],
  namePrompt: '{bright}WHAT IS YOUR NAME?{/}',
};

export const hub = {
  greeting: [
    'The square is quiet. A dog sleeps under the fountain, unbothered.',
    'Ash drifts down from the north. Nobody in Redgate looks up anymore.',
    'A cart creaks past. The driver does not return your nod.',
    'The forest is where the gold is. Everyone in town knows it. Nobody says it.',
  ],
  menu: {
    f: 'Fight',
    i: 'Inn',
    b: 'Bank',
    s: 'Shop',
    h: 'Healer',
    c: 'Character',
    w: "Who's Who",
    p: 'Attack',
    d: 'Wyrm',
    q: 'Quit',
    '?': 'Help',
  } as Record<string, string>,
  noTurns: [
    'You are out of turns. The forest can wait; it is patient.',
    'Your legs will not carry you another fight today.',
  ],
  turnsLeft: (n: number) => `{dim}${n} ${plural(n, 'turn', 'turns')} remaining today.{/}`,
  wyrmUnlocked: '{red}North, past the treeline, the mountain has been smoking since dawn.{/}',
};

export const combat = {
  encounter: [
    'You step into the clearing. {dim}Something is breathing.{/}',
    'The trees thin. You are not alone in them.',
    'A branch snaps behind you. You turn.',
  ],
  monsterAppear: (name: string, desc: string) => [
    `{bright}${name}{/} lurches out of the treeline!`,
    `{dim}${desc}{/}`,
  ],
  hit: [
    'Your blade finds its mark. {bright}{n}{/} damage.',
    'You open a line across its arm. {bright}{n}{/} damage.',
    'Steel meets meat. {bright}{n}{/} damage.',
    'You put your weight behind it. {bright}{n}{/} damage.',
  ],
  crit: ['{bright}A critical blow!{/} {n} damage.'],
  miss: [
    'You swing wide. Nothing but leaves.',
    'The strike goes where the monster was.',
    'Your footing slips. The blow is wasted.',
  ],
  monsterHit: [
    'It hits you. {red}{n}{/} damage.',
    'Claws rake across your side. {red}{n}{/} damage.',
    'You are too slow. {red}{n}{/} damage.',
  ],
  monsterMiss: [
    'It lunges and misses. You feel the wind of it.',
    'The blow glances off your guard.',
    'It overreaches. You are still standing.',
  ],
  dodge: 'You slip aside. {dim}Thieves learn this first.{/}',
  victory: [
    'It falls. The forest goes quiet again.',
    'It stops moving. You check your own ribs, then its purse.',
    'The clearing is yours. It smells like it.',
  ],
  defeat: [
    'The ground comes up to meet you.',
    'You hear your own heartbeat. Then you do not.',
    'The last thing you see is the canopy, very far away.',
  ],
  xp: (xp: number, gold: number) => `{gold}+${xp} experience{/}  {gold}+${gold} gold{/}`,
  damageFrom: (n: number) => `{red}${n} damage{/}`,
  fleeFail: 'You turn to run. The forest is not finished with you.',
};

export const levelUp = {
  announce: (roman: string, titleName: string) =>
    `You have reached level ${roman}. {white}${titleName}{/}`,
  stats: '{dim}Two points of growth. Your body decides where they go.{/}',
  fullHeal: '{dim}You feel whole again. It will not last.{/}',
  maxLevel: 'You have reached level XII. The mountain is waiting.',
};

export const death = {
  variants: [
    '{dim}You awaken on a straw pallet. Someone has taken your purse.{/}',
    '{dim}You come to on a straw pallet. Your pouch is lighter. Your head is worse.{/}',
    '{dim}The healer is standing over you. She does not look impressed.{/}',
  ],
  goldLost: (n: number) => `{red}You have lost ${n} gold.{/}`,
  xpLost: (n: number) => `{dim}Some of what you learned died with you. −${n} experience.{/}`,
  revive: (hp: number) => `{dim}The healer patches you to ${hp} and points at the door.{/}`,
  wyrmLaugh: "{red}The wyrm's laughter follows you out of the cave.{/}",
};

export const shop = {
  greet: [
    'The smith looks at your weapon, then at you. He does not comment.',
    'The shop smells of oil and hot metal.',
    'The smith is eating. He puts the bowl down.',
  ],
  buyHeader: 'FOR SALE',
  sellHeader: 'YOUR KIT',
  notEnoughGold: 'You cannot afford that. The smith already knew.',
  notEnoughGems: 'The gems are part of the price. He does not haggle about gems.',
  bought: (name: string) => `{bright}You buy the ${name}.{/}`,
  sold: (name: string, gold: number) => `{dim}You sell the ${name} for ${gold} gold.{/}`,
  cannotSellEquipped: 'You are wearing it. Take it off first.',
  cannotSellLast: 'You would be walking out of here with your hands empty.',
  wow: (w: number, a: number) => `{dim}Your kit: ${w} damage, ${a} armor.{/}`,
  nothingToSell: 'You have nothing the smith wants.',
};

export const bank = {
  greet: [
    'The clerk counts your coins twice, then writes a number down.',
    'A cage of iron bars and one very calm man.',
  ],
  balance: (gold: number, banked: number, cap: number) =>
    `{dim}Carried: ${gold}g   Banked: ${banked}g / ${cap}g{/}`,
  interest: (n: number) => `{gold}The bank paid you ${n} gold in interest overnight.{/}`,
  deposited: (n: number) => `{dim}Deposited ${n} gold.{/}`,
  withdrew: (n: number) => `{dim}Withdrew ${n} gold.{/}`,
  capNote: '{dim}The bank takes interest only up to five thousand gold.{/}',
  nothing: 'There is nothing to move.',
};

export const healer = {
  greet: [
    'The healer has seen worse. She has also seen you.',
    'Herbs, bandages, and a bucket she does not explain.',
  ],
  cost: (n: number) => `{dim}Full healing costs ${n} gold.{/}`,
  healed: '{bright}You are restored. Try to stay that way.{/}',
  noGold: 'You cannot afford the herbs. She suggests the forest.',
  alreadyFull: 'You are not hurt. She looks almost disappointed.',
  freeNote: '{dim}She does not charge for the dying. Only for the wounded.{/}',
};

export const inn = {
  greet: [
    'The inn is warm and smells of onion soup. Wren is behind the bar.',
    'Two tables occupied. One argument in progress. Wren is ignoring it.',
  ],
  wren: [
    [
      'She looks up. "You are new."',
      '"I am Wren. I remember everyone who drinks here."',
      '{dim}She goes back to wiping the same clean cup.{/}',
    ],
    [
      '"You came back." She sounds mildly surprised, which stings.',
      'She pours something amber without asking what you wanted.',
      '"On the house. Do not get used to it."',
    ],
    [
      '"You have been in the forest." It is not a question.',
      '"The mountain has been smoking. The wyrm wakes every third breath to strike twice — once for the wound, once for the insult."',
      '{dim}She says it like a warning. It is one.{/}',
    ],
    [
      'She looks at the ring for a long moment.',
      '"This belonged to someone." She does not ask who.',
      '"I will keep it. I will be here." {dim}She means it.{/}',
    ],
    [
      'She is waiting at the door, which is not where she stands.',
      '"They said the mountain went quiet."',
      '{dim}She takes your hand. The inn keeps its own hours tonight.{/}',
    ],
  ],
  drinkCost: (n: number) => `{dim}Buy her a drink for ${n} gold? [Y] / [N]{/}`,
  ringCost: (n: number) => `{dim}Gift her a ring for ${n} gold? [Y] / [N]{/}`,
  noGold: 'You dig for coin and come up with lint. She pretends not to notice.',
  charmFail: '"You are sweet." It is the worst sentence you have ever heard.',
  stage123: 'She is not finished with you. Nobody is, in a place like this.',
  rumor: [
    '{dim}A drunk says the wyrm has not eaten in a week. The drunk is wrong.{/}',
    '{dim}Someone mentions a man who went north with a runed blade. Past tense.{/}',
  ],
  stageProgress: (stage: number) => `{dim}Wren: ${stage} of 5.{/}`,
  waiting: 'She has already said yes. She is waiting for you to come back from the north.',
  noWren: '{dim}Wren is not behind the bar tonight.{/}',
};

export const character = {
  header: 'CHARACTER SHEET',
  rows: {
    name: 'Name',
    class: 'Class',
    level: 'Level',
    xp: 'Experience',
    hp: 'Health',
    mana: 'Mana',
    str: 'Strength',
    def: 'Defense',
    agi: 'Agility',
    chm: 'Charm',
    gold: 'Gold',
    banked: 'Banked',
    gems: 'Gems',
    weapon: 'Weapon',
    armor: 'Armor',
    kills: 'Kills',
    deaths: 'Deaths',
    turns: 'Turns left',
    titles: 'Titles',
  },
  nextLevel: (n: number) => `{dim}${n} experience to the next level.{/}`,
  maxLevel: '{gold}No further levels. Only the mountain.{/}',
  noTitles: '{dim}—{/}',
};

export const whoIsWho = {
  header: "WHO'S WHO",
  sub: 'Top ten living adventurers, by experience.',
  columns: '  #  NAME             CLASS     LVL  KILLS  TITLE',
  empty: 'The realm is empty. That will change.',
  footer: '{dim}Residents are simulated. The node is honest about its ghosts.{/}',
};

export const hall = {
  header: 'HALL OF FAME',
  sub: 'All who have slain the Ashen Wyrm, oldest first.',
  columns: '  DATE        NAME             CLASS       DAYS',
  empty: 'No one has killed it yet. The wyrm knows this.',
  footer: '{dim}Days taken is real days, not turns. Patience is a stat.{/}',
  entryDays: (n: number, plural: string) => `${n} ${plural}`,
};

export const pvp = {
  header: 'CHOOSE A TARGET',
  noTargets: 'There is no one within reach. The realm is quiet.',
  rangeNote: (n: number) => `{dim}Only those within ${n} levels of you.{/}`,
  costNote: '{dim}An attack costs a turn. You may lose it.{/}',
  win: (name: string, gold: number) =>
    `{bright}You beat ${name}.{/} {gold}You take ${gold} gold.{/}`,
  lose: (name: string, gold: number) =>
    `{red}${name} beats you.{/} {dim}They take ${gold} gold.{/}`,
  stealOk: (gold: number) =>
    `{bright}Your hand finds their purse.{/} {gold}${gold} gold, and no one saw.{/}`,
  stealFail: (name: string) => `{red}Their hand closes on your wrist.{/} ${name} saw everything.`,
  feedWin: (attacker: string, victim: string, gold: number) =>
    `${attacker} defeated ${victim} and took ${gold} gold.`,
  feedSteal: (attacker: string, victim: string, gold: number) =>
    `${attacker} lifted ${gold} gold from ${victim} in the street.`,
  feedRaid: (attacker: string, gold: number) =>
    `{dim}${attacker} has taken ${gold} gold from you while you slept.{/}`,
};

export const forest = {
  intro: 'You take the north path. The town noise falls away behind you.',
  encounter: 'The path bends. Someone is sitting against a stone.',
  leave: 'You leave them to it and walk on.',
};

export const encounters = {
  soldier: {
    title: 'The Wounded Soldier',
    lines: [
      'A soldier sits against a stone, holding his side.',
      '"Fifty gold and I will remember you kindly," he says. "Or do not. I will likely be dead."',
    ],
    prompt: '{dim}Give him 50 gold? [Y] / [N]{/}',
    accept: [
      'He takes the coin with both hands. Something in his shoulders lets go.',
      '"North of here. The old shrine still answers, if you are polite."',
      '{dim}You feel steadier for it. The forest seems to agree.{/}',
    ],
    refuse: 'You walk on. He does not call after you. That is somehow worse.',
    noGold: 'You reach for coin and find none. He nods anyway.',
  },
  gypsy: {
    title: 'The Gypsy',
    lines: [
      'A woman in a red scarf spreads her hands. Two stones sit in each palm.',
      '"One gem. One guess. One of these stones is worth two."',
    ],
    prompt: '{dim}Gamble a gem? [Y] / [N]{/}',
    win: ['She turns her hand over. The stone is warm.', '{gold}You gain a gem.{/}'],
    lose: ['She turns her hand over. Empty.', '{dim}You have lost a gem.{/}'],
    noGems: 'You have no gems. She loses interest immediately.',
    refuse: 'She shrugs and reshuffles her stones for the next traveler.',
  },
  stranger: {
    title: 'A Beautiful Stranger',
    lines: [
      'A woman waits at the bend in the road, as though the road was built around her.',
      '"You look like someone worth talking to," she says. This is not a compliment.',
    ],
    success: [
      'You say something you will not remember, and it works.',
      'She laughs, once, and is gone before you can be pleased about it.',
      '{bright}+1 Charm.{/}',
    ],
    fail: [
      'You say something. She listens politely. Her hand is very quick.',
      '{red}She has lifted a tenth of your purse.{/}',
    ],
  },
  wizard: {
    title: 'The Dying Wizard',
    lines: [
      'A man in grey is folded against a tree, and his hands are still moving.',
      '"I have one spell left in me," he says. "You may as well have it."',
    ],
    magician: [
      '"Ah. One of mine." He presses two fingers to your forehead.',
      '{bright}You learn a spell. It costs you nothing.{/}',
      '{dim}He does not get up.{/}',
    ],
    other: [
      'He looks at your hands and decides against it.',
      '"You would not know what to do with it." He presses a gem into your palm instead.',
      '{gold}+1 gem.{/}',
    ],
    exhausted: '{dim}You already know everything he has to teach.{/}',
  },
  shrine: {
    title: 'The Old Shrine',
    lines: [
      'A stone altar, older than the town, half-swallowed by moss.',
      'Someone has left bread. It is fresh. That is unsettling.',
    ],
    prompt: '{dim}Pray? [Y] / [N]{/}',
    heal: ['{bright}Warmth moves through you. Your wounds close.{/}'],
    stat: ['Something settles in your bones.', '{bright}+1 to a stat.{/}'],
    gold: ['{red}You feel lighter. Not in the good way.{/}'],
    nothing: ['Nothing happens. You wait. Nothing continues to happen.'],
    refuse: 'You leave the bread where it is.',
  },
  peddler: {
    title: 'The Peddler',
    lines: [
      'A cart with one wheel, and a man who is very keen for you to look inside.',
      '"Two hundred gold. It cuts like a dream. Slight problem with the balance."',
    ],
    prompt: '{dim}Buy the blade for 200 gold? [Y] / [N]{/}',
    accept: [
      'The blade is lighter than it looks. It hums when you hold it wrong.',
      '{bright}You gain the Peddler\u2019s Blade: +6 damage, \u22123 armor.{/}',
    ],
    refuse: 'He packs it away without a word. The cart creaks off.',
    noGold: 'You cannot afford it. He knows before you say it.',
  },
};

export const dragon = {
  locked: 'The mountain path is there. You are not ready for it.',
  attemptUsed: '{dim}You have already been to the mountain today. It is still smoking.{/}',
  respawn: (days: number) =>
    `{dim}The wyrm is not home. It returns in ${days} ${plural(days, 'day', 'days')}.{/}`,
  intro: [
    'The cave breathes warm air at you, like something asleep.',
    'Ash falls from a ceiling you cannot see.',
    '{bright}THE ASHEN WYRM{/} uncoils from the dark.',
    '{dim}It has been waiting a very long time and is not impressed.{/}',
  ],
  doubleAttack: '{red}It strikes twice — once for the wound, once for the insult.{/}',
  victory: [
    'The wyrm comes apart. The mountain goes quiet for the first time in years.',
    '{gold}You are Wyrmbane.{/}',
    '{dim}They will sing about this badly, in a town you will never visit.{/}',
  ],
  defeat: '{red}It is faster than the stories. You did not finish the story.{/}',
  offerRetire: '{dim}[R] Retire — freeze this character and keep the entry forever.{/}',
  offerContinue: '{dim}[C] Continue — the wyrm returns in seven days, stronger.{/}',
  retired: 'You hang your sword above the bar. Wren does not ask if you are sure.',
  continueNote: '{dim}You keep the title. The mountain keeps its grudge.{/}',
  married: 'Wren is waiting at the door of the inn, and the ledger is closed for the night.',
};

export const settings = {
  header: 'SETTINGS',
  rows: [
    'S — Scanlines',
    'F — Flicker',
    'G — Grain',
    'C — Curvature',
    'A — Sound',
    'T — Theme (green / amber)',
    'B — Contrast boost',
    'Y — Typewriter speed',
  ],
  saved: '{dim}Settings saved.{/}',
  reducedMotion: '{dim}Your system asks for reduced motion. It has been honoured.{/}',
};

export const errors = {
  noTurns: 'You have no turns left today.',
  levelTooLow: 'You are not ready. The mountain knows.',
  notEnoughGold: 'Not enough gold.',
  nameTaken: 'That name is already known on this node.',
  unknownCommand: (k: string) => `{dim}Unknown command: ${k}. Type ? for help.{/}`,
};

export const help = {
  header: 'KEYBOARD',
  lines: [
    '[F] Forest      [I] Inn         [B] Bank      [S] Shop',
    '[H] Healer      [C] Character   [W] Who\u2019s Who [P] Attack',
    '[D] Wyrm        [Q] Quit        [?] This screen [ESC] Back',
    '[Y] Yes         [N] No          [1-9] Select an item',
    '',
    'Any key skips the typewriter. Menus take a single keypress — no Enter.',
    'All interaction is keyboard-only by design. Nothing here needs a mouse.',
  ],
};

export const quitting = [
  'CARRIER LOST.',
  '{dim}Your character is written to the ledger. The node keeps its own hours.{/}',
  '{dim}Return tomorrow. There are ten more turns waiting for you.{/}',
];

export const realm = {
  residentLevel: (name: string, roman: string, cls: string) =>
    `${name} the ${cls} has reached level ${roman}.`,
  residentKill: (name: string, victim: string, gold: number) =>
    `${name} struck down ${victim} on the north road. ${gold} gold changed hands.`,
  wyrmSlain: (name: string) => `{gold}${name} has slain the Ashen Wyrm.{/}`,
};

export const titles = [
  'Wanderer',
  'Wanderer',
  'Sellsword',
  'Sellsword',
  'Man-at-Arms',
  'Man-at-Arms',
  'Knight',
  'Knight',
  'Banneret',
  'Banneret',
  'Champion',
  'Champion',
];

export function titleForLevel(level: number, isWyrmbane: boolean): string {
  if (isWyrmbane) return 'Wyrmbane';
  const idx = Math.max(1, Math.min(12, level));
  return titles[idx - 1];
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function className(id: string): string {
  if (id === 'warrior') return 'Warrior';
  if (id === 'magician') return 'Magician';
  if (id === 'thief') return 'Thief';
  return id;
}
