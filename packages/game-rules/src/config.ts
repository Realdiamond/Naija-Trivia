/**
 * Remote-config defaults (GDD §10). The server overrides them from `app_config`,
 * and the admin console edits them with history and rollback (doc 18 §11).
 */
export const DEFAULT_CONFIG = {
  'duel.timer_text_s': 15,
  'duel.timer_media_s': 20,
  'duel.turn_expiry_h': 48,
  'party.max_players_free': 20,
  'party.max_players_pass': 50,
  'score.speed_max': 100,
  'score.streak_step': 20,
  'score.streak_cap': 4,
  'econ.win_coins': 30,
  'econ.loss_coins': 10,
  'econ.daily_coins': 20,
  'econ.daily_streak_coins': 5,
  'econ.daily_coins_max': 50,
  'econ.level_up_coins': 100,
  'econ.rewarded_ad_coins': 25,
  'econ.lifeline_fifty': 60,
  'econ.lifeline_ask_naija': 80,
  'econ.lifeline_skip': 100,
  'econ.lifeline_time': 40,
  'ads.interstitial_every_n_matches': 3,
  'ads.rewarded_daily_cap': 10,
  'content.repeat_window_days': 30,
  'difficulty.k_factor': 8,
  'web.rewarded_daily_cap': 5,
  'web.install_prompt_after_sessions': 2,
} as const;

export type ConfigKey = keyof typeof DEFAULT_CONFIG;
/** The values in force: the defaults with staff's changes on top. */
export type GameConfig = { readonly [K in ConfigKey]: number };

export interface Tunable {
  key: ConfigKey;
  /** What it is, in the console. */
  label: string;
  min: number;
  max: number;
  /** The apps need it too, so `GET /v1/config` sends it. */
  client?: boolean;
}

/**
 * The values staff can change in the console without a release (doc 18 §11, step 2.7g): the
 * economy, which can change at any moment without hurting a game in progress. Timers, scoring,
 * room sizes and the like stay as written until their screens can take a change mid-game.
 */
export const TUNABLE: readonly Tunable[] = [
  { key: 'econ.win_coins', label: 'Coins for winning a duel', min: 0, max: 500 },
  { key: 'econ.loss_coins', label: 'Coins for losing or drawing a duel', min: 0, max: 500 },
  { key: 'econ.daily_coins', label: "Coins for the Daily on a streak's first day", min: 0, max: 500 },
  {
    key: 'econ.daily_streak_coins',
    label: 'Extra Daily coins for each further streak day',
    min: 0,
    max: 100,
  },
  { key: 'econ.daily_coins_max', label: 'Most coins one Daily pays', min: 0, max: 1000 },
  { key: 'econ.level_up_coins', label: 'Coins for each level reached', min: 0, max: 1000 },
  { key: 'econ.rewarded_ad_coins', label: 'Coins for a rewarded video', min: 0, max: 200, client: true },
  { key: 'ads.rewarded_daily_cap', label: 'Rewarded videos that pay, per player per day', min: 0, max: 50 },
  {
    key: 'ads.interstitial_every_n_matches',
    label: 'An ad between games after every … finished duels',
    min: 1,
    max: 20,
    client: true,
  },
  { key: 'econ.lifeline_fifty', label: 'Price of 50/50', min: 0, max: 1000, client: true },
  { key: 'econ.lifeline_ask_naija', label: 'Price of Ask Naija', min: 0, max: 1000, client: true },
  { key: 'econ.lifeline_skip', label: 'Price of Skip', min: 0, max: 1000, client: true },
  { key: 'econ.lifeline_time', label: 'Price of +10s', min: 0, max: 1000, client: true },
];

export function tunable(key: string): Tunable | undefined {
  return TUNABLE.find((t) => t.key === key);
}
