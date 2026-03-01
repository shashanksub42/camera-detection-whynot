# camera-detection-whynot
why am I doing this- idk???

## what even is this

a web app that uses your laptop webcam to detect your hands in real time. does it serve any practical purpose? absolutely not. did I build it anyway? apparently yes.

## what does it actually do

- detects your hands live using mediapipe (google's hand tracking thing, runs entirely in the browser, no server needed)
- draws little blue skeleton lines on your fingers 
- tells you which fingers are up or down and tries to name the gesture

## the naruto thing (the real reason this exists probably)

what happens when it activates:
- 15 copies of just you (background removed) start popping in one by one around the screen

background removal is done with mediapipe's selfie segmentation model so the clones are (hopefully) just you and not your entire desk setup.

## how to run it

```bash
cd "camera detection"
python3 -m http.server 5500
```

then open `http://localhost:5500` in chrome and allow camera permissions when it asks.

do NOT just open index.html as a file. the webcam api requires http. yes this matters. yes I learned this the hard way.

## stack

html + css + vanilla js + mediapipe hands + mediapipe selfie segmentation. no frameworks. no build step. no reason.
