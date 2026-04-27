# 🔬 EchoMetrics — Carcass Ultrasound Analyzer

A web application for precise measurement of **Longissimus dorsi muscle area (AOL/REA)** and **subcutaneous fat thickness (EGS/BFT)** from B-mode ultrasound images — directly in the browser, no software installation required.

Designed for livestock research in cattle, sheep, goats, and other ruminants.

---

## ✨ Features

- **Interactive annotation modal** — zoom-enabled pop-up for accurate point placement
- **Smooth contour drawing** — click to add control points; drag to adjust; right-click or Backspace to undo
- **Pixel-to-cm calibration** — mark any 1 cm segment on the scale bar to calibrate
- **Individual or batch mode** — analyze single images or process a full session and download results as Excel
- **Keyboard shortcuts** — `Escape` (close), `Backspace` (undo last point), `Enter` (confirm shape)
- **Privacy-first** — images are processed in memory and never stored on the server

---

## 🚀 Quick Start

```bash
pip install -r requirements.txt
python app.py
```

Open your browser at `http://localhost:5000`

---

## 📐 Measurement Workflow

| Step | Action |
|---|---|
| **1. Calibrate** | Click two points on the scale bar representing exactly 1 cm |
| **2. Draw AOL** | Place control points around the *Longissimus dorsi* cross-section |
| **3. Measure EGS** | Click two points to define the fat thickness |
| **Result** | AOL (cm²), EGS (cm), calibration (px/cm) — instant |

---

## 📁 Project Structure

```
EchoMetrics/
├── app.py                  # Flask backend
├── requirements.txt
├── render.yaml             # Render deployment config
├── templates/
│   └── index.html
├── static/
│   ├── css/style.css
│   └── js/script.js
├── .gitignore
└── README.md
```

---

## 🌐 Deployment (Render)

1. Push this repository to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repository
4. Render detects `render.yaml` automatically — click **Deploy**

Your app will be live at `https://echometrics-m33u.onrender.com`.

---

## 📄 Citation

If you use this tool in a scientific publication, please cite it as:

```
Araujo, C. (2025). EchoMetrics: A web-based tool for measuring Longissimus dorsi area
and subcutaneous fat thickness from B-mode ultrasound images in livestock.
GitHub. https://github.com/CintiaAraujo-Zoo/EchoMetrics
```

---

## ⚖️ License

MIT License — see [`LICENSE`](LICENSE) for details.

---

## 👤 Author

**Cintia Araujo (Kaoru)**  
Faculty, UESPI — Campus Corrente  
Doctoral Researcher, UNIVASF — Programa de Pós-Graduação em Zootecnia  
Visiting Researcher, University of Illinois at Urbana-Champaign (UIUC)
