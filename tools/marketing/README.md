# Awareness posts

Posters and a short video for WhatsApp Status and other places, in the game's colours and fonts,
made before launch to build awareness.

```sh
node tools/marketing/posters.mjs   # PNGs: Status poster, square post, question posters with answers
node tools/marketing/video.mjs     # MP4: 16-second Status video (needs ffmpeg)
```

Both write to `tools/marketing/out/` (not kept in git). They draw HTML in Chromium through
Playwright, so run `pnpm install` first.

- To change the words, edit the HTML in each script; the shared colours, fonts and pattern band are
  in `common.mjs`.
- Question posters use questions from the question bank whose answers are certain. Check any new
  one against its source before posting it.
- There is no website or social handle on them yet. Add it to the `soon()` block in
  `posters.mjs` and the last scene in `video.mjs` once the domain and handles are settled.
