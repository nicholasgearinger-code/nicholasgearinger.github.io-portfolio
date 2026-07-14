// Ghostwire Radio — track list.
//
// This is the one place to edit to add, remove, or reorder music in the
// game. Each entry needs a `file` (relative to this music/ folder) and a
// `title`; `artist` is optional but shows up in the "On Air" readout.
//
// Current tracks: "Sci-Fi Music Pack Vol. 3" by Alkakrab, royalty-free /
// free to use with attribution. https://alkakrab.itch.io/sci-fi-music-pack-vol-3
//
// The radio picks a random track on first play and auto-advances to
// another random track (never immediately repeating) whenever one ends,
// plus the in-game skip button jumps to a new one anytime. If this array
// is empty, the radio widget just stays hidden — the rest of the game is
// unaffected.
//
// IMPORTANT: only add music you actually have the rights to publish here
// (your own compositions, or explicitly royalty-free / Creative Commons /
// licensed tracks). This file ends up on a public website, which is
// legally different from just having a file on your own computer —
// don't add commercial tracks you don't hold a license to redistribute.

window.GHOSTWIRE_TRACKS = [
  { title: 'Abandoned Outpost', artist: 'Alkakrab', file: 'abandoned-outpost.mp3' },
  { title: 'Entering the Void', artist: 'Alkakrab', file: 'entering-the-void.mp3' },
  { title: 'Approaching the Singularity', artist: 'Alkakrab', file: 'approaching-the-singularity.mp3' },
  { title: 'Lost Signal', artist: 'Alkakrab', file: 'lost-signal.mp3' },
  { title: 'Beyond the Star Gate', artist: 'Alkakrab', file: 'beyond-the-star-gate.mp3' },
  { title: 'Signal from Beyond', artist: 'Alkakrab', file: 'signal-from-beyond.mp3' },
  { title: 'Awakening the Relic', artist: 'Alkakrab', file: 'awakening-the-relic.mp3' },
  { title: 'Lost Star System', artist: 'Alkakrab', file: 'lost-star-system.mp3' },
  { title: 'Ruins of Tomorrow', artist: 'Alkakrab', file: 'ruins-of-tomorrow.mp3' },
  { title: 'Edge of the Galaxy', artist: 'Alkakrab', file: 'edge-of-the-galaxy.mp3' },
  { title: 'Before the Warp', artist: 'Alkakrab', file: 'before-the-warp.mp3' },
  { title: 'Echoes from the Station', artist: 'Alkakrab', file: 'echoes-from-the-station.mp3' },
  { title: 'Beneath Alien Skies', artist: 'Alkakrab', file: 'beneath-alien-skies.mp3' },
  { title: 'Collapse of the Core', artist: 'Alkakrab', file: 'collapse-of-the-core.mp3' },
  { title: 'Fractured Space-Time', artist: 'Alkakrab', file: 'fractured-space-time.mp3' },
  { title: 'The Long Jump', artist: 'Alkakrab', file: 'the-long-jump.mp3' },
  { title: 'Through the Wormhole', artist: 'Alkakrab', file: 'through-the-wormhole.mp3' },
  { title: 'Breach the Horizon', artist: 'Alkakrab', file: 'breach-the-horizon.mp3' },
  { title: 'Scanning the Unknown', artist: 'Alkakrab', file: 'scanning-the-unknown.mp3' },
  { title: 'Breach of the Voidline', artist: 'Alkakrab', file: 'breach-of-the-voidline.mp3' },
];
