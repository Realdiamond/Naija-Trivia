# 04 · Content Strategy & Question Bible

**Version:** 1.1 · **Date:** 15 Oct 2026
**Why this doc matters:** in a trivia game the content *is* the product. HQ Trivia ran out of novelty and Trivia Crack grew by localising content. Our edge over global apps is content only Nigerians would get right.

---

## 1. Category taxonomy (MVP)

| Category | Emoji | Sub-categories | Launch target (approved Qs) | Weekly refresh |
|---|---|---|---|---|
| **Slang & Pidgin** | 🗣️ | Street slang, Pidgin grammar, Gen Z slang, old-school slang, "finish the expression", Yoruba/Igbo/Hausa loanwords | 600 | 25+ |
| **Nollywood** | 🎬 | Classics (1992–2005), New Nollywood (2010+), box office, actors & roles, iconic lines, Kannywood, streaming originals, TV series | 600 | 10+ |
| **Music** | 🎶 | Afrobeats era (2010+), Afrobeat & Fela, 2000s Naija pop, highlife & jùjú, fuji & apala, gospel, records & awards, real names, labels | 600 | 25+ |
| **Food** | 🍲 | Soups & swallows, street food, drinks, regional dishes, ingredients, party food, snacks | 600 | 5+ |
| **Sport** | ⚽ | Super Eagles and Super Falcons, youth teams, AFCON and the World Cup, clubs and stadiums, Nigerians abroad, athletics and the Olympics, boxing, MMA, basketball, other sports | 600 | 10+ |
| **Mixed Naija** | 🇳🇬 | Geography, history (non-political), BBNaija & TV, tech & brands, Lagos life, school days | 600 | 10+ |
| **(v1.1) Throwback** | 📼 | 90s/2000s TV, adverts, old Naija music | 300 | – |
| **(v2) Kannywood & Arewa** | 🌙 | Northern film, music, food, Hausa language | 300 | 5+ |

**Launch total: ≥ 3,600 approved questions** (3,000 before Sport was added as a sixth category in October 2026). Sport questions never touch betting or odds, and anything that can change (captains, coaches, records) carries a `valid_until` date. At an average of 9 questions a match and a 30-day no-repeat window per player, 600 per category supports heavy daily play for ~2 months before re-use. Freshness is then kept up by the weekly pipeline.

### Difficulty mix per category
- Level 1 (easy, "even your mama sabi"): 15%
- Level 2: 20%
- Level 3 (medium): 30%
- Level 4: 20%
- Level 5 (expert, "na only Baba Sabi go know"): 15%

---

## 2. Editorial principles (the "Question Bible")

### 2.1 The 10 rules
1. **One true answer.** If two options could be argued as correct, rewrite it. For slang with several meanings, ask "Which is the MOST common meaning of…"
2. **Verifiable.** Every factual question has a `source_url` in the CMS (Nairametrics, Pulse, The Native, Grammy.com, BusinessDay, NBS, Wikipedia as a last resort). Slang questions cite at least two usages, such as a tweet, a Zikoko article or a song lyric.
3. **Time-stamped.** Anything that can change ("current", "latest", "highest-grossing", "most streamed") gets an "as of <Month Year>" in the text **and** a `valid_until` date.
4. **Short.** Question ≤ 120 characters, options ≤ 30 characters each. Long text loses on a 15 s timer.
5. **Plausible distractors.** All wrong options must be believable to someone who doesn't know: same type, similar length, and no joke options except in "Funny" packs.
6. **No tribal, religious or political baiting.** No questions that mock an ethnic group, religion, region, gender or disability. No partisan politics, no living politicians as punchlines. History is fine when neutral and factual (e.g. independence date).
7. **Family-safe by default.** Questions with mild innuendo or alcohol themes are flagged `family_safe=false` and excluded from Family mode and under-18 accounts.
8. **Respect the dead and the bereaved.** No questions about the circumstances of a celebrity's death.
9. **Spell names right.** Use each artist's own styling (e.g. "Ayra Starr", "Asake", "2Baba"). Keep a house **name dictionary** in the CMS.
10. **Represent all of Nigeria.** Within each category, aim for at least 25% of content from outside Lagos (North, East, South-South, Middle Belt). Track it with the `region_tag` field.

### 2.2 Voice
- The question is plain and clear; the personality lives in the "Did you know?" fact and the feedback copy.
- Pidgin is welcome in Slang questions and feedback. Factual questions use standard English so they can be read quickly.

### 2.3 Format conventions
| Field | Rule |
|---|---|
| `text` | Sentence case, ends with "?" (or "…" for finish-the-line) |
| `options` | No "All of the above" or "None of the above" |
| `fact` | ≤ 160 characters, adds something new, not just a restatement of the answer |
| `image` | WebP, ≤ 40 KB, 640×360 max, own photography or licensed (no Google-image grabs) |
| `audio` | Opus, ≤ 5 s, ≤ 30 KB, licensed or originally recorded |

---

## 3. Content pipeline

```
 Sources & trend scans ─▶ Writer drafts (CMS) ─▶ Fact-check ─▶ Sensitivity review ─▶ Editor approve
          ▲                                                                       │
          │                                                                       ▼
   Player reports ◀── Live analytics (correct %, report rate, d_q) ◀── Rotation (A/B pool)
```

| Stage | Who | SLA | Tooling |
|---|---|---|---|
| Trend scan | Content lead | Monday weekly | X/TikTok trending, Zikoko, Pulse, Nairametrics box office (Fri), Apple Music & Spotify Nigeria charts, TurnTable Charts |
| Draft | Freelance writers (5–8, paid per approved Q) | Rolling | CMS draft form with duplicate detection |
| Fact-check | Second writer | 48 h | Checklist + source URL required |
| Sensitivity review | Editor (rotating regional reviewers: North, East, South-South) | 48 h | Flags: tribe, religion, gender, politics |
| Approve & schedule | Editor | – | Assign to packs; set `valid_until` |
| Calibrate | Automatic | Nightly | Elo item difficulty (GDD §6.3) |
| Review queue | Editor | 24 h for auto-suspended Qs | Report dashboard |

The CMS is the Content module of the admin console ([doc 18](18-admin-console-and-analytics.md)). Each question shows its live performance next to the editor: plays, correct %, average answer time, option split and reports, by platform.

### Writer economics *(inferred, adjust to market)*
- Pay ₦300–₦600 per **approved** question (higher for image questions and verified hard questions).
- 3,000 launch questions × ~₦450 average ≈ **₦1.35M** (~US$1,000), plus editor time.
- Ongoing: ~100 new questions a week ≈ ₦45k a week.

### Question Factory (user submissions, v1.1)
- Players at Level 5 or above can submit questions.
- Submissions go through community voting (thumbs up/down by Level 10+ players), then editor approval.
- Approved authors are credited on the question ("Question by @tolu_sabi") and get 150 coins.
- Expected yield: about 10% of submissions are approved. Fast for slang, not for facts.

### AI assistance (optional)
- An LLM can **suggest distractors**, spot duplicates and check style. **No AI-generated fact goes live without human verification and a source URL.** AI-written Nigerian cultural "facts" hallucinate often.

---

## 4. Duplicate & quality controls
- **Near-duplicate detection:** normalised text plus trigram similarity (> 0.7 flags), and the same correct answer combined with category similarity.
- **Answer-key sanity:** if the most chosen answer is a distractor at > 50% after 300 answers, the question comes out of the game and goes into the reports queue for an editor (the nightly check, build plan step 2.6b). Under 5% or over 97% right after 300 answers files a report too, and the question stays in the game.
- **Report thresholds:** ≥ 5 "wrong answer" reports, or > 3% of plays reported, auto-suspends the question.
- **Expiry:** a nightly job removes questions with `valid_until < today`.

---

## 5. Rights & licensing
| Asset | Approach |
|---|---|
| Song **titles, artists, facts** | Facts aren't copyrightable, so these are fine |
| **Short lyric quotes** | Limit to ≤ 6 words; prefer paraphrase. Seek label permission for lyric-heavy packs |
| **Audio clips** | Need licences from labels or publishers (e.g. Mavin, YBNL, Chocolate City, Sony Music West Africa, Universal Music Nigeria). Alternative: commission original "hum-along" recordings |
| **Film stills / celebrity photos** | Use licensed stock or official promo assets with permission. Default: **illustrated** caricatures by our artist (avoid using real likenesses in ads) |
| **Brand logos** | Only in sponsored packs with a written brand agreement |
| **Movie quotes** | Short quotes for trivia are generally low-risk; avoid reproducing scenes. Get counsel's view on fair dealing under the Copyright Act 2022 |

---

## 6. Localisation plan
| Phase | UI language | Question content |
|---|---|---|
| MVP | English | English + Pidgin in Slang |
| v1.1 | + Pidgin UI | Pidgin pack |
| v2 | + Yoruba, Igbo, Hausa UI | Native-language packs written by native writers, not translated |

Translation must be **transcreation**: jokes and slang are rewritten, not translated literally.

---

## 7. Seed question set
A starter set of **114 draft questions** across the five categories is in [`content/seed-questions.csv`](content/seed-questions.csv): 104 multiple choice and 10 `closest_number` questions for duel tie-breaks. In the seed file the correct answer is always `option_a` so it's easy to review; a `closest_number` question leaves the options empty and puts the number in `correct_option`. The server shuffles options for each player when it serves a question (TRD §5.4), and the importer stores options as an array with a `correct_index`.

> **Every seed question has status `draft`. Each one must pass the fact-check and sensitivity steps above before it goes live.** Time-sensitive items carry a `valid_until` date. Box office and award facts were checked against Nairametrics, Intelpoint and Music in Africa in October 2026.

### Sample (from the CSV)

**Slang & Pidgin, easy**
> What does "japa" mean?
> A) To relocate abroad ✅ · B) To eat quickly · C) To dance · D) To borrow money
> *Did you know?* "Japa" is Yoruba for "run away" or "flee", and became the word for emigrating during the 2020s wave.

**Nollywood, medium**
> Who directed *The Wedding Party* (2016)?
> A) Kemi Adetiba ✅ · B) Niyi Akinmolayan · C) Kunle Afolayan · D) Funke Akindele
> *Did you know?* Niyi Akinmolayan directed the sequel, *The Wedding Party 2* (2017).

**Music, medium**
> Which Burna Boy album won the Grammy for Best Global Music Album in 2021?
> A) Twice as Tall ✅ · B) African Giant · C) Love, Damini · D) I Told Them…

**Food, easy**
> Which of these is NOT a swallow?
> A) Moi moi ✅ · B) Eba · C) Amala · D) Semo

**Mixed Naija, hard**
> What is the highest mountain in Nigeria?
> A) Chappal Waddi ✅ · B) Obudu Plateau · C) Zuma Rock · D) Olumo Rock

---

## 8. LiveOps content calendar (first 6 months)
| Moment | Date (approx.) | Pack / event |
|---|---|---|
| Independence Day | 1 Oct | "Naija @ 66" history & culture pack |
| Detty December | 1–31 Dec | "Detty December" (concerts, owambe, travel, "IJGB" slang) |
| Christmas / New Year | 24 Dec–1 Jan | "Village People" pack (hometown food, festivals) |
| AFCON / Super Eagles fixtures | per CAF calendar | Football flash packs |
| Valentine's | 14 Feb | "Nollywood Romance" |
| Grammys | Feb | "Afrobeats Grammys" pack |
| Ramadan & Sallah | per calendar | Arewa food & culture (family-safe) |
| Easter | Mar/Apr | Family pack |
| BBNaija season | Jul–Oct | Weekly BBNaija flash quiz (evergreen-safe Qs only) |
| Headies / AMVCA | per event | Award-night live party rooms |
| Box office Friday | weekly | "What's showing?" 3-question flash |
