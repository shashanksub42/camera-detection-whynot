# camera-detection-whynot
why am I doing this- idk???

## what even is this

a web app that uses your laptop webcam to detect your hands in real time. does it serve any practical purpose? absolutely not. did I build it anyway? apparently yes.

## what does it actually do

- detects your hands live using mediapipe (google's hand tracking thing, runs entirely in the browser, no server needed)
- draws little blue skeleton lines on your fingers
- tells you which fingers are up or down and tries to name the gesture

## the naruto thing (the real reason this exists probably)

there's a little reference box at the bottom of the screen showing the shadow clone seal. hold up **either hand** with your **index and middle fingers extended** and everything else curled. hold it for half a second and watch the progress bar fill.

what happens when it activates:
- **35 clones** of just you start popping in one by one every 120ms
- they spawn at random positions and sizes scattered around the screen
- they appear **behind you** — segmentation strips your background so you stay in front
- clones are full opacity and look exactly like your live video
- kanji flashes at the top that says 影分身の術！(kage bunshin no jutsu)

background removal is done with mediapipe's selfie segmentation model so the clones are (hopefully) just you and not your entire desk setup.

drop the sign and they all disappear. do it again and they respawn in different random positions.

## how to run it

```bash
cd "camera detection"
python3 -m http.server 5500
```

then open `http://localhost:5500` in chrome and allow camera permissions when it asks.

do NOT just open index.html as a file. the webcam api requires http. yes this matters. yes I learned this the hard way.

## stack

html + css + vanilla js + mediapipe hands + mediapipe selfie segmentation. no frameworks. no build step. no reason.

---

## 🎵 audio detection — chord detector

a second web app that listens through your microphone and tells you in real time which chord is being played in any song.

### what does it do

- captures mic input using the **Web Audio API** and runs a 16,384-point FFT (~2.7 Hz/bin resolution)
- computes per-pitch-class energy by pooling note frequencies across octaves C2–C7
- uses an **adaptive noise floor** so it cuts through background noise automatically — plus a manual sensitivity slider for fine-tuning
- matches the detected notes against a library of **180 chords** across 12 roots (C through B) and 15 chord types: major, minor, dominant 7th, major 7th, minor 7th, diminished, diminished 7th, half-diminished (m7b5), augmented, sus2, sus4, major 6th, minor 6th, add9, and power chords
- scoring uses a **weighted F-score** that balances how many chord tones were heard (recall) against ghost notes (precision), biased toward recall so partial chords still resolve correctly
- shows which of the 12 pitch classes are currently active as glowing note bubbles
- displays the matched chord name, its constituent notes, and a confidence percentage
- keeps a scrolling **history** of the last 20 distinct chords detected
- renders a **live log-scale spectrum** (20–4000 Hz) with active note bins highlighted in purple and a threshold line in red

### how to run it

```bash
cd "audio detection"
python3 -m http.server 5501
```

then open `http://localhost:5501` in chrome and allow microphone permissions when it asks.

same deal as the camera app — must be served over http, not opened as a raw file.

### tips

- get the sound source close to the mic for best results
- hold the chord for at least half a second so the FFT has time to settle
- use the sensitivity slider to raise the threshold if ambient noise is triggering false detections
- works best with clean guitar, piano, or any instrument with clear harmonic content

### stack

html + css + vanilla js + Web Audio API. no external libraries. no server-side processing. everything runs in the browser.
