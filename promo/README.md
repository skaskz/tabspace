# Tabspace promo video

The [Remotion](https://www.remotion.dev) project behind the 50-second Tabspace tour
([watch it](../docs/media/tabspace-promo.mp4)). Everything is code: scenes are React components, and the music and sound
effects are synthesized by a Node script, so there are no third-party audio licences.

## Render it

```bash
# 1. From the repo root: build the extension and capture screenshots (example data only)
npm run build
node scripts/promo-shots.mjs            # writes promo/public/shots/*.png

# 2. In this folder
cd promo
npm install
npm run audio                           # synthesizes public/audio/*.wav
npm run dev                             # preview in Remotion Studio
npm run render                          # writes out/tabspace-promo.mp4
```

## Layout

```
src/
  Root.tsx            compositions (full video + one per scene)
  TabspacePromo.tsx   scene order, transitions and sound cues
  theme.ts            colours, fonts and timing
  components/         starfield, logo, UI mock pieces
  scenes/             Intro, NewTab, Workspaces, TasksNotes, Focus, Bar, Customize, Grid, Tagline, Outro
scripts/make-audio.mjs  music bed + SFX generator
```

Remotion is free for individuals and small teams; larger companies need a
[company licence](https://www.remotion.dev/license).
