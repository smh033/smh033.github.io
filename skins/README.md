# Player skins

A skin replaces a player's whole on-field sprite. In the game, open a player
(Roster → tap a player) and tap **SKIN** under his picture to pick one.

Everything for skins lives in this folder:

- `skins.json`: the list of skins the game offers
- one PNG sprite sheet per skin, e.g. `placeholder.png` (the temporary robot)

## Sprite sheet format

- **PNG with a transparent background.**
- **9 frames, each 12 pixels wide × 16 pixels tall**, side by side in one row,
  so the whole image is **108 × 16 pixels**. Draw at 1 pixel = 1 pixel; the game
  scales it up with crisp pixels.
- The player **faces right**. The game flips him when he runs left.
- His **feet touch the bottom row** (y = 15) in every frame except the dive.
- The game adds the black outline around the sprite, so don't draw one.

| Frame | x position | Pose |
|-------|------------|------|
| 0 | 0–11   | standing still |
| 1 | 12–23  | running, step 1 (front leg reaching forward) |
| 2 | 24–35  | running, step 2 (legs passing under the body) |
| 3 | 36–47  | running, step 3 (other leg forward) |
| 4 | 48–59  | running, step 4 (legs passing) |
| 5 | 60–71  | diving forward, body low and stretched, arms out in front |
| 6 | 72–83  | running with the football tucked under the arm |
| 7 | 84–95  | throwing, arm cocked back holding the ball |
| 8 | 96–107 | reaching up with both hands to catch |

You can use fewer frames: one frame (12 × 16) is used for every pose, and five
frames (60 × 16) give a standing frame and a run cycle. Any pose that's missing
uses the standing frame.

### Team colors (optional)

Pixels in these exact colors are repainted with the player's team uniform, so one
skin works for every team:

| Paint this exact color | It becomes |
|------------------------|------------|
| `#FF00FF` (magenta) | the team's jersey color |
| `#00FFFF` (cyan)    | the team's second color (trim) |
| `#FFFF00` (yellow)  | the team's helmet color |

Any other color stays exactly as drawn.

## Adding a skin

1. Put the PNG in this folder, e.g. `skins/ninja.png`. Use lowercase letters, numbers
   and dashes in the file name.
2. Add a line for it to the `"skins"` list in `skins.json`:

   ```json
   {
     "frame": [12, 16],
     "frames": ["stand", "run1", "run2", "run3", "run4", "dive", "carry", "throw", "reach"],
     "skins": [
       { "id": "placeholder", "name": "ROBOT (TEMP)", "file": "placeholder.png" },
       { "id": "ninja", "name": "NINJA", "file": "ninja.png" }
     ]
   }
   ```

   - `id`: a short unique name. Don't change it later, because saved players remember it.
   - `name`: what the game shows (keep it short, CAPITALS).
   - `file`: the PNG's file name in this folder.
3. Commit and push. The new skin shows up in the SKIN picker after a reload.

### Optional settings per skin

You can add any of these to a skin's line in `skins.json`:

- `"frame": [24, 32]`: this sheet's frame size in pixels, if it isn't 12 × 16. A bigger,
  more detailed drawing works too: keep all 9 frames the same size, side by side.
- `"scale": 0.5`: how big one sheet pixel is compared with the normal 12 × 16 player.
  For a 24 × 32 sheet, use 0.5 so the player is the normal size on the field.
- `"tint": false`: turns off the team-color repaint, so the colors stay exactly as drawn.
- `"carrySplit": 0.68`: when a skin runs with the ball, the game draws the carry frame's top part over the
  run frames' legs so the legs move. This is where it cuts (0.68 = 68% down from the top). Raise it if the
  ball gets cut off, lower it if the carry pose's legs show.
- `"secret": true`: hidden (shown as SECRET) until it's unlocked by an easter egg.
- `"egg": 1` to `"egg": 4`: this is the skin that easter egg unlocks (1 = tap FOOTBALL on the title
  screen 7 times, 2 = tap RETRO 7 times, 3 = tap the row of little players 7 times, 4 = tap an empty spot on the title screen 7 times). Use it together with `"secret": true`.

- `"eggTitle": "00 KING"` and `"eggSub": "ANTAGONIST TOUR"`: the big dripping title and the gold line under it in
  easter eggs 3 and 4 (used on the skin with `"egg": 3` or `"egg": 4`). Long titles shrink to fit.
- `"trail": "sandevistan"`: running leaves a trail of neon afterimages behind the player (cyan, pink, yellow,
  green, purple); faster running stretches it out.
- `"codeShow": "america"`: plays a show before a code's skin unlocks (`america`: waving flag, fireworks and a brass
  fanfare; `winter`: snowfall, aurora, frost and sleigh bells). `eggTitle` / `eggSub` set its text.
- `"code": "Cross"`: players unlock this skin by typing the code on the title screen's CODES button
  (capitals don't matter). Use it together with `"secret": true`. Anyone who opens skins.json on GitHub can read it.

Example: `{ "id": "hero", "name": "HERO", "file": "hero.png", "frame": [24, 32], "scale": 0.5 }`

To **replace the temporary robot**, either draw over `placeholder.png` (same file
name, so players already wearing it update automatically) or add a new skin and
remove the placeholder entry.

## Prompt you can give another AI

Image AIs can't output exact pixel sizes, so ask for a 10× grid and then shrink it to
216 × 32 (24 × 32 frames, `"frame": [24, 32], "scale": 0.5`).

> Pixel-art sprite sheet for a retro football game, side view, character faces RIGHT.
> One horizontal row of exactly 9 equal-width frames, no gaps, borders or labels. Each
> frame is a 24×32 pixel-art grid drawn at 10× scale (every art pixel is a 10×10 block),
> so each frame is 240×320 and the sheet is 2160×320. Fully transparent background, no
> shadows or floor. Character fills each frame's height, feet on the bottom edge (except
> the dive), centered in its own frame, same size in every frame. Frames left to right:
> 1 standing, 2–5 a 4-step run cycle, 6 diving forward low and horizontal with arms out
> front (still inside its frame), 7 running with a football tucked under one arm,
> 8 throwing with the arm cocked back holding the ball, 9 jumping with both hands up to
> catch. Crisp hard-edged pixels, no anti-aliasing, blur or gradients, limited palette,
> thin dark outline. The character is: **[describe your character here]**.
