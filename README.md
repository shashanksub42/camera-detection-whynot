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
