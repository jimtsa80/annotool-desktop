# Annotool

Browser tool for annotating sports-broadcast frames (brand, location, hits). The copy on GitHub Pages does not include this branch until it is merged.

## Run locally

The folder picker needs a secure page. `http://localhost` counts. Opening the HTML file directly (`file://`) does not.

From this folder:

```bash
python -m http.server 8000
```

Open http://localhost:8000 in Chrome or Edge. Load the preferences file and the images folder as usual, then press **Ζωντανά** and choose a folder the assistant can read and write. The choice is remembered in this browser. Next time, **Σύνδεση** grants access again if the browser asks. A red dot and **εκτός** mean sync is off. A green dot and **συνδεδεμένο** mean the folder is live. Right-click **Ζωντανά** to pick a different folder. Firefox and Safari have no folder picker; the control then shows a short note.

While the folder is connected, the tool writes `annotool_live.json` about 2.5 seconds after a change and on every autosave (60s). It reads `annotool_predictions.json` from the same folder about every 2 seconds.

## Live file (`annotool_live.json`)

Same object `downloadAnnotations` stores, one box per logo instance (this is the training file). `convert_to_yolo.py` reads `images`, `width`, `height`, `imageName`, and each annotation's `startPoint`, `diagPoint`, `brand`, and `tpoint`. Three extra fields sit next to that object. They are not part of a delivery download.

| Field | Meaning |
| --- | --- |
| `syncedAt` | ISO-8601 time of this write |
| `currentImage` | Frame open right now (already part of the export). Filename stem, or `folder/stem` when several folders are open |
| `currentImageIndex` | Index of that frame in the current folder |
| `reviewed` | Frames the annotator has left with Next, Prev, S, or A. The open frame is not in this list |

A frame in `reviewed` with no entry in `images` was looked at and left empty: use it as a negative. A frame in neither `reviewed` nor `images` has not been finished: ignore it. Frames skipped with Shift+S are not reviewed.

Image keys and `imageName` are the filename stem (no extension). `width` and `height` are the tool canvas size, not necessarily the file's pixel size. `startPoint` is `[x, y]` and `diagPoint` is the opposite corner, in that canvas, origin at the top-left, y downward. `hits` on a live box is the hits on that one instance (1 when each logo was drawn separately).

```json
{
  "project": "match",
  "imageNum": 2,
  "prefs": {},
  "images": {
    "00012": {
      "imageName": "00012",
      "imageIndex": 0,
      "width": 960,
      "height": 540,
      "annotations": [
        {
          "startPoint": [120, 400],
          "diagPoint": [280, 470],
          "group": "",
          "brand": "Adidas",
          "tpoint": "LED",
          "hits": 1,
          "timestamp": "2026-11-14T12:00:00.000Z"
        },
        {
          "startPoint": [300, 400],
          "diagPoint": [460, 470],
          "group": "",
          "brand": "Adidas",
          "tpoint": "LED",
          "hits": 1,
          "timestamp": "2026-11-14T12:00:01.000Z"
        }
      ]
    }
  },
  "currentImage": "00013",
  "presets": {},
  "Annotator": "ada",
  "syncedAt": "2026-11-14T17:20:00.000Z",
  "currentImageIndex": 1,
  "reviewed": ["00012"]
}
```

The file is written with one `createWritable` / `close`, so a reader does not see a half-written body. If a parse fails, read it again.

## Predictions file (`annotool_predictions.json`)

Same shape `predict_to_json.py` writes (a normal annotool JSON). Drop that script's output in the sync folder under this name. No conversion.

Each annotation is `startPoint`, `diagPoint`, `group`, `brand`, `tpoint`, `hits`, in the canvas given by that image's `width` and `height`. `confidence` (or `conf`) is optional and is only shown on the suggestion. Image keys are filename stems, matching `imageName`.

When the annotator lands on a frame that has no boxes yet, each predicted annotation is drawn as its own suggestion. Two rows with the same brand and location stay two boxes (`hits` kept from each row, usually 1). Nothing is written over a frame that already has annotations. **Όλες** accepts every suggestion, **Ναι** accepts one, **Όχι** or **Καμία** rejects. Drag a box, then accept it. Accepted boxes become normal annotations.

A pre-merged prediction (one row whose `hits` is already the count) is one box with that hits value. For per-instance suggestions, write one annotation per logo (`--no-dedupe-brand-tpoint`). See `examples/annotool_predictions.json`.

## Merge on export

**συγχώνευση** (on by default) applies only to json / photos.csv / video.csv / news.csv.

On a frame, rows with the same `brand` and `tpoint` become one annotation. The rectangle is the highest `confidence` instance. With no confidence, or a tie, the earliest box is kept. `hits` is the sum of the instances' hits, so three `hits: 1` boxes become `hits: 3`, and one older box that already stored `hits: 5` stays 5. The downloaded annotation has the usual keys only: `startPoint`, `diagPoint`, `group`, `brand`, `tpoint`, `hits`, and `timestamp` when the kept box had one. `syncedAt`, `reviewed`, and `currentImageIndex` are left out of the download. The browser autosave keeps every instance.
