/**
 * Boot sequence copy. Lives on the client because it is pure presentation:
 * no game state, no rules, nothing the server needs to decide.
 */
export const boot = {
  lines: [
    'BKM REALM NODE 01 ........................ READY',
    '2400 BAUD ................................. OK',
    'CARRIER DETECT ............................ DIAL',
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

  /**
   * The offer, shown only when sound is off. A silent node is a lesser node,
   * but it is the player's call — so we ask once, plainly, and accept no.
   */
  soundOff: {
    headline: 'SOUND IS OFF',
    body: [
      'This node has a modem, a keyboard, and things in the forest.',
      'You are about to miss all of it.',
    ],
    yes: '[Y] TURN IT ON — dial in with sound',
    no: '[N] CONTINUE IN SILENCE',
    hint: 'you can change this any time from SET',
  },

  /** Shown before the player has touched anything, once sound is settled. */
  dialPrompt: 'PRESS ANY KEY TO DIAL IN',
  dialHint: 'the modem answers. headphones recommended.',

  /** Shown while the handshake runs. */
  asking: 'NEGOTIATING CARRIER .......................',
  connected: 'CARRIER ESTABLISHED ....................... OK',

  /** Shown instead of `connected` when the player chose silence. */
  silent: 'CONNECTED — SILENT MODE ................... OK',
};
