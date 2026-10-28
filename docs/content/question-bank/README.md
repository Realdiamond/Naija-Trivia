# Question bank

Researched draft questions waiting for the team's fact-check, one CSV per category plus an Excel workbook to review them in. The launch target is 600 approved questions per category ([doc 04 §1](../../04-content-strategy-and-question-bible.md)), and the rules every question follows are the Question Bible in [doc 04 §2](../../04-content-strategy-and-question-bible.md).

Nothing here is live in the game. A question goes in only after a person marks it **approved**.

## Files

| File | What it is |
|---|---|
| `slang.csv`, `nollywood.csv`, `music.csv`, `food.csv`, `mixed.csv`, `sport.csv` | The questions, one file per category. These are the source of truth |
| `question-bank.xlsx` | The same questions as a workbook: a summary sheet with progress, and one sheet per category with the review columns in yellow |
| `questionbank.py` | `check` tests every rule below; `build` copies reviews from the workbook into the CSVs, then rebuilds the workbook |

The 114 older drafts are still in [`../seed-questions.csv`](../seed-questions.csv).

## How to review (content team)

1. Download `question-bank.xlsx` and open it in Excel or Google Sheets.
2. On a category sheet, open each `source_url` and check the fact, the spelling and that only one answer is right. **The right answer is always in `option_a`**; the game shuffles the options for each player.
3. Fill in only the yellow columns: `review_status` (approved, fix needed or rejected), `reviewer` and `review_notes`.
4. Save it as `.xlsx` with the same name and upload it to this folder on GitHub (Add file → Upload files), or send it to whoever runs the next build. The next `build` copies your marks into the CSVs, so they are never lost.

## Columns

The same columns as `seed-questions.csv`, plus the source and the review:

| Column | Rule |
|---|---|
| `id` | Category prefix and a number: `SLG`, `NOL`, `MUS`, `FOD`, `MIX`, `SPT`, e.g. `SPT-0007`. Never reused |
| `type` | `mcq4` (four options, the right one in `option_a`, `correct_option` = `a`) or `closest_number` (no options, the number in `correct_option`, used for duel tie-breaks) |
| `difficulty` | 1 (easy) to 5 (expert); aim for 15% / 20% / 30% / 20% / 15% |
| `question` | ≤ 120 characters, ends with `?` (or `…` for finish-the-line) |
| `option_a`–`option_d` | ≤ 30 characters each, all believable, same kind of answer |
| `fact` | ≤ 160 characters, adds something the answer doesn't say |
| `valid_until` | For anything that can change: the question starts "As of <Month Year>," and expires on this date (`2027-10-31`) |
| `region_tag` | `ALL`, `SW`, `SE`, `SS`, `N` or `NC`; at least 25% of each category from outside Lagos |
| `source_url`, `source_title` | The page that confirms the fact. Required |
| `added_on` | The date the draft was written |
| `review_status`, `reviewer`, `review_notes` | Filled in by the team: `to check`, `approved`, `fix needed`, `rejected` |

## Where questions come from

Questions are written in our own words from facts confirmed on reliable pages: governing bodies (CAF, FIFA, World Athletics, Olympics.com), the BBC, Nigerian newspapers (Premium Times, Punch, Vanguard, The Guardian Nigeria), official artist, film and award pages, and Wikipedia when nothing better confirms it. **We never copy other quiz sites' questions or scrape social media**: facts are free to use, but someone else's question text is not, and social media terms and data-protection law (NDPA) forbid bulk scraping. Slang questions cite at least two real usages.

Drafts are written with AI help, so **every one needs a human check against its source** before it is approved (doc 04 §3).

## Adding questions

1. Append rows to the category's CSV with the next free ids and `review_status` = `to check`.
2. Run `python3 docs/content/question-bank/questionbank.py check` and fix every error. Treat duplicate warnings as errors unless the questions really are different.
3. Run `python3 docs/content/question-bank/questionbank.py build` and commit the CSV and the workbook together.

A scheduled job adds a new batch on the `question-bank` branch every day and pushes it to GitHub, so nothing depends on any one session.
