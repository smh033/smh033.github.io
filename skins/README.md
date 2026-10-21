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
- `"secret": true`: hidden (shown as SECRET) until it's unlocked by an easter egg.
- `"egg": 1` or `"egg": 2`: this is the skin that easter egg unlocks (1 = tap FOOTBALL on the title
  screen 7 times, 2 = tap RETRO 7 times). Use it together with `"secret": true`.

Example: `{ "id": "hero", "name": "HERO", "file": "hero.png", "frame": [24, 32], "scale": 0.5 }`

To **replace the temporary robot**, either draw over `placeholder.png` (same file
name, so players already wearing it update automatically) or add a new skin and
remove the placeholder entry.

## Prompt you can give another AI

> Make a pixel-art sprite sheet PNG for a retro football game. Transparent
> background, exactly 108×16 pixels: 9 frames of 12×16 pixels side by side, 1 pixel = 1
> pixel, no anti-aliasing, no outline (the game adds one). The character faces right
> and his feet touch the bottom row. Frames left to right: 0 standing, 1–4 a 4-step
> running cycle, 5 diving forward (low and stretched, arms out front), 6 running with a
> football tucked under one arm, 7 throwing (arm cocked back holding the ball),
> 8 reaching up with both hands. Paint the jersey in pure #FF00FF, the trim/second color
> in pure #00FFFF and the helmet in pure #FFFF00 so the game can recolor them per team.
> The character is: **[describe your skin here, e.g. a ninja with a black mask]**.
