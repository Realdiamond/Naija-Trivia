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
  'content.repeat_window_days': 30,
  'difficulty.k_factor': 8,
  'web.rewarded_daily_cap': 5,
  'web.install_prompt_after_sessions': 2,
} as const;

export type ConfigKey = keyof typeof DEFAULT_CONFIG;
