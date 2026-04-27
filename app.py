"""
EchoMetrics — Carcass Ultrasound Analyzer
Flask backend — stateless design (no files persisted on server).

Images are processed in memory and discarded immediately.
Excel files are generated on-demand and streamed directly to the browser.

Run locally:
    python app.py

Deploy (Render / production):
    gunicorn app:app --bind 0.0.0.0:10000
"""

import io
import os
import uuid

import cv2
import numpy as np
import openpyxl
from flask import Flask, Response, jsonify, render_template, request, url_for
from werkzeug.utils import secure_filename

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "bmp"}
MAX_UPLOAD_MB = 20

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024
app.config["DEBUG"] = os.environ.get("FLASK_DEBUG", "false").lower() == "true"

# In-memory image store: {token: bytes}
# Images live only for the duration of one analysis session.
_image_store: dict[str, bytes] = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def safe_batch_code(raw: str) -> str:
    cleaned = "".join(c for c in str(raw) if c.isalnum() or c == "_")
    return cleaned[:32] or "BATCH"


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# API — image upload & serve
# ---------------------------------------------------------------------------
@app.route("/upload", methods=["POST"])
def upload_file():
    """
    Receives an image, stores it in memory with a random token,
    and returns a URL the canvas can use to display it.
    Nothing is written to disk.
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file or file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "File type not allowed"}), 400

    token = uuid.uuid4().hex
    _image_store[token] = file.read()

    return jsonify({
        "token": token,
        "url": url_for("serve_image", token=token),
    })


@app.route("/image/<token>")
def serve_image(token: str):
    """Serves a previously uploaded image from the in-memory store."""
    data = _image_store.get(token)
    if not data:
        return "Not found", 404
    mime = "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        mime = "image/png"
    elif data[:4] == b"GIF8":
        mime = "image/gif"
    elif data[:2] == b"BM":
        mime = "image/bmp"
    return Response(data, mimetype=mime)


@app.route("/discard/<token>", methods=["POST"])
def discard_image(token: str):
    """Frees an image from memory once analysis is complete."""
    _image_store.pop(token, None)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# API — calculate
# ---------------------------------------------------------------------------
@app.route("/calculate", methods=["POST"])
def calculate():
    """
    Receives calibration points, AOL polygon, and fat measurement points.
    Returns AOL (cm²), EGS (cm), and calibration factor (px/cm).
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid JSON payload"}), 400

    try:
        p1s, p2s = data["scalePoints"][0], data["scalePoints"][1]
        dist_px = float(np.sqrt(
            (p1s["x"] - p2s["x"]) ** 2 + (p1s["y"] - p2s["y"]) ** 2
        ))
        if dist_px < 1:
            return jsonify({"error": "Calibration points are too close together"}), 400

        pixels_per_cm = dist_px  # scale bar represents exactly 1 cm

        aol_pts = np.array(
            [[p["x"], p["y"]] for p in data["aolPoints"]], dtype=np.int32
        )
        aol_cm2 = cv2.contourArea(aol_pts) / (pixels_per_cm ** 2)

        p1f, p2f = data["fatPoints"][0], data["fatPoints"][1]
        fat_cm = float(np.sqrt(
            (p1f["x"] - p2f["x"]) ** 2 + (p1f["y"] - p2f["y"]) ** 2
        )) / pixels_per_cm

        return jsonify({
            "aol_cm2": round(aol_cm2, 2),
            "fat_thickness_cm": round(fat_cm, 2),
            "pixels_per_cm": round(pixels_per_cm, 2),
        })

    except (KeyError, IndexError, TypeError) as exc:
        return jsonify({"error": f"Missing or malformed data: {exc}"}), 400
    except Exception as exc:
        return jsonify({"error": f"Calculation error: {exc}"}), 500


# ---------------------------------------------------------------------------
# API — download Excel
# ---------------------------------------------------------------------------
@app.route("/download_excel", methods=["POST"])
def download_excel():
    """
    Receives all batch rows as JSON and returns a ready-to-download Excel file.
    Generated entirely in memory — nothing saved on the server.

    Expected body:
        {
            "batchCode": "LOTE01",
            "rows": [
                {"imageCode": "LOTE0101", "aol": 12.3, "egs": 0.4},
                ...
            ]
        }
    """
    data = request.get_json(silent=True)
    if not data or not data.get("rows"):
        return jsonify({"error": "No data to export"}), 400

    batch_code = safe_batch_code(data.get("batchCode", "BATCH"))

    try:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Results"
        ws.append(["Image", "AOL (cm²)", "EGS (cm)"])

        for row in data["rows"]:
            ws.append([
                str(row.get("imageCode", "")),
                float(row.get("aol", 0)),
                float(row.get("egs", 0)),
            ])

        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)

        return Response(
            buf.getvalue(),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f'attachment; filename="{batch_code}_results.xlsx"'
            },
        )

    except Exception as exc:
        return jsonify({"error": f"Excel generation error: {exc}"}), 500


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------
@app.errorhandler(413)
def file_too_large(e):
    return jsonify({"error": f"File exceeds the {MAX_UPLOAD_MB} MB limit"}), 413


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=app.config["DEBUG"])
