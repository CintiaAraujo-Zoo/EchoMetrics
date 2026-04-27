/**
 * EchoMetrics — client-side analysis logic
 *
 * Architecture: stateless backend.
 * - Uploaded images are stored in server memory with a token and discarded after use.
 * - Batch results accumulate in JS (batchRows array).
 * - Excel is generated server-side on demand and downloaded directly by the browser.
 *
 * Keyboard shortcuts (modal open):
 *   Escape     → close modal
 *   Backspace  → undo last point
 *   Enter      → confirm shape
 *
 * Right-click on canvas → undo last point
 */

document.addEventListener('DOMContentLoaded', () => {

    // -----------------------------------------------------------------------
    // DOM references
    // -----------------------------------------------------------------------
    const imageLoader         = document.getElementById('imageLoader');
    const resetButton         = document.getElementById('resetButton');
    const finalImageEl        = document.getElementById('finalImage');
    const instructionsEl      = document.getElementById('instructions');
    const aolResultEl         = document.getElementById('aolResult');
    const fatResultEl         = document.getElementById('fatResult');
    const calibrationResultEl = document.getElementById('calibrationResult');
    const modeRadios          = document.querySelectorAll('input[name="analysisMode"]');
    const batchControls       = document.getElementById('batch-controls');
    const startBatchButton    = document.getElementById('startBatchButton');
    const batchCodeInput      = document.getElementById('batchCode');
    const fileUploadArea      = document.getElementById('file-upload-area');
    const toastContainer      = document.getElementById('toast-container');
    const downloadExcelButton = document.getElementById('downloadExcelButton');

    // Modal
    const modal               = document.getElementById('modal');
    const modalCanvas         = document.getElementById('modalCanvas');
    const modalCtx            = modalCanvas.getContext('2d');
    const modalTitleEl        = document.getElementById('modalTitle');
    const modalInstructionsEl = document.getElementById('modalInstructions');
    const closeModalButton    = document.getElementById('close-modal');
    const confirmStepButton   = document.getElementById('confirm-step-button');
    const zoomInButton        = document.getElementById('zoom-in');
    const zoomOutButton       = document.getElementById('zoom-out');
    const zoomLevelEl         = document.getElementById('zoom-level');

    // -----------------------------------------------------------------------
    // Application state
    // -----------------------------------------------------------------------
    let state = {};

    function initializeState() {
        state = {
            analysisMode     : 'individual',
            batchCode        : '',
            batchCounter     : 1,
            batchRows        : [],        // accumulates {imageCode, aol, egs} per image
            currentStep      : 'IDLE',
            image            : null,
            token            : null,      // server-side image token
            scalePoints      : [],
            aolPoints        : [],
            fatPoints        : [],
            isDragging       : false,
            draggedPointIndex: -1,
            hoverPointIndex  : -1,
            mousePos         : { x: 0, y: 0 },
            zoomLevel        : 1.0,
            canvasW          : 0,
            canvasH          : 0,
        };
    }

    // -----------------------------------------------------------------------
    // Toast notifications
    // -----------------------------------------------------------------------
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.classList.add('toast', type);
        toast.textContent = message;
        toastContainer.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 500);
        }, 4000);
    }

    // -----------------------------------------------------------------------
    // Application flow
    // -----------------------------------------------------------------------
    function resetApplication() {
        // Discard current image from server memory
        if (state.token) {
            fetch(`/discard/${state.token}`, { method: 'POST' }).catch(() => {});
        }
        initializeState();
        document.querySelector('input[name="analysisMode"][value="individual"]').checked = true;
        batchControls.classList.add('hidden');
        fileUploadArea.classList.remove('hidden');
        if (downloadExcelButton) downloadExcelButton.classList.add('hidden');
        imageLoader.value = '';
        finalImageEl.style.display = 'none';
        finalImageEl.src = '';
        aolResultEl.textContent          = '-- cm²';
        fatResultEl.textContent          = '-- cm';
        calibrationResultEl.textContent  = '-- px/cm';
        updateMainInstructions();
        closeModal();
    }

    function handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        fetch('/upload', { method: 'POST', body: formData })
            .then(r => r.json())
            .then(data => {
                if (data.error) throw new Error(data.error);
                state.token = data.token;
                state.image = new Image();
                state.image.src = data.url;
                state.image.onload = () => {
                    openModal();
                    setStep('CALIBRATING');
                };
            })
            .catch(err => showToast(`Upload error: ${err.message}`, 'error'));
    }

    function calculateResults() {
        modalInstructionsEl.innerHTML = 'Calculating…';

        // Densely sample the smooth AOL curve for area accuracy
        const highResAol = [];
        if (state.aolPoints.length > 2) {
            for (let t = 0; t <= 1; t += 0.005) {
                highResAol.push(getPointOnCurve(state.aolPoints, t));
            }
        }

        fetch('/calculate', {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({
                token      : state.token,
                scalePoints: state.scalePoints,
                aolPoints  : highResAol,
                fatPoints  : state.fatPoints,
            }),
        })
        .then(r => r.json())
        .then(results => {
            if (results.error) throw new Error(results.error);

            aolResultEl.textContent         = `${results.aol_cm2} cm²`;
            fatResultEl.textContent         = `${results.fat_thickness_cm} cm`;
            calibrationResultEl.textContent = `${results.pixels_per_cm} px/cm`;

            if (state.analysisMode === 'batch_running') {
                saveBatchRow(results.aol_cm2, results.fat_thickness_cm);
            } else {
                discardCurrentImage();
                setStep('DONE');
                closeModal();
                drawFinalImage();
            }
        })
        .catch(err => {
            showToast(`Calculation error: ${err.message}`, 'error');
            resetApplication();
        });
    }

    function saveBatchRow(aol, egs) {
        const imageCode = `${state.batchCode}${String(state.batchCounter).padStart(2, '0')}`;

        // Store row in JS — no server call needed
        state.batchRows.push({ imageCode, aol, egs });
        state.batchCounter++;

        showToast(`${imageCode} saved (${state.batchRows.length} image${state.batchRows.length > 1 ? 's' : ''} in batch)`, 'success');

        // Show download button as soon as we have at least one row
        if (downloadExcelButton) downloadExcelButton.classList.remove('hidden');

        discardCurrentImage();
        setStep('DONE');
        closeModal();
        drawFinalImage();
        updateMainInstructions();
    }

    function discardCurrentImage() {
        if (state.token) {
            fetch(`/discard/${state.token}`, { method: 'POST' }).catch(() => {});
            state.token = null;
        }
    }

    function downloadExcel() {
        if (!state.batchRows.length) {
            showToast('No data to export yet.', 'error');
            return;
        }

        fetch('/download_excel', {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({
                batchCode: state.batchCode,
                rows     : state.batchRows,
            }),
        })
        .then(response => {
            if (!response.ok) return response.json().then(d => { throw new Error(d.error); });
            return response.blob();
        })
        .then(blob => {
            // Trigger browser file download
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = `${state.batchCode}_results.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            showToast('Excel downloaded successfully!', 'success');
        })
        .catch(err => showToast(`Download error: ${err.message}`, 'error'));
    }

    function confirmStep() {
        if (state.currentStep === 'DRAWING_AOL') {
            if (state.aolPoints.length > 2) {
                setStep('DRAWING_FAT');
            } else {
                showToast('Draw at least 3 points to define the AOL area.', 'error');
            }
        }
    }

    function undoLastPoint() {
        if (state.currentStep === 'DRAWING_AOL' && state.aolPoints.length > 0) {
            state.aolPoints.pop();
            draw();
        } else if (state.currentStep === 'CALIBRATING' && state.scalePoints.length > 0) {
            state.scalePoints.pop();
            draw();
        }
    }

    function startBatch() {
        const code = batchCodeInput.value.trim().toUpperCase();
        if (code) {
            state.batchCode    = code;
            state.batchCounter = 1;
            state.batchRows    = [];
            state.analysisMode = 'batch_running';
            batchControls.classList.add('hidden');
            fileUploadArea.classList.remove('hidden');
            if (downloadExcelButton) downloadExcelButton.classList.add('hidden');
            updateMainInstructions();
        } else {
            showToast('Please enter a batch code before starting.', 'error');
        }
    }

    // -----------------------------------------------------------------------
    // UI helpers
    // -----------------------------------------------------------------------
    function setStep(newStep) {
        state.currentStep = newStep;
        updateModalInstructions();
        draw();
    }

    function drawFinalImage() {
        draw();
        finalImageEl.src = modalCanvas.toDataURL('image/png');
        finalImageEl.style.display = 'block';
    }

    function handleModeChange(event) {
        state.analysisMode = event.target.value;
        if (state.analysisMode === 'batch') {
            state.analysisMode = 'batch_setup';
            batchControls.classList.remove('hidden');
            fileUploadArea.classList.add('hidden');
        } else {
            batchControls.classList.add('hidden');
            fileUploadArea.classList.remove('hidden');
        }
        updateMainInstructions();
    }

    function updateMainInstructions() {
        let title, text;
        switch (state.analysisMode) {
            case 'individual':
                title = 'Individual Mode';
                text  = state.currentStep === 'DONE'
                    ? 'Analysis complete! Load another image to continue.'
                    : 'Load an image to start the analysis.';
                break;
            case 'batch_setup':
                title = 'Batch Mode — Setup';
                text  = 'Enter a batch code (e.g. LOTE01) and click <strong>Start Batch</strong>. Results accumulate in memory and you can download the Excel at any time.';
                break;
            case 'batch_running': {
                const nextCode = `${state.batchCode}${String(state.batchCounter).padStart(2, '0')}`;
                const saved    = state.batchRows.length;
                title = `Batch Mode — ${state.batchCode}`;
                text  = `<strong>${saved}</strong> image${saved !== 1 ? 's' : ''} saved. `
                      + (state.currentStep === 'DONE'
                            ? `Load the file for <strong>${nextCode}</strong>.`
                            : `Ready for <strong>${nextCode}</strong>.`);
                break;
            }
        }
        instructionsEl.innerHTML = `<h3><i class="fa-solid fa-info-circle"></i> ${title}</h3><p>${text}</p>`;
    }

    function updateModalInstructions() {
        let title, text;
        confirmStepButton.style.display = 'none';
        switch (state.currentStep) {
            case 'CALIBRATING':
                title = 'Step 1 — Calibrate (1 cm)';
                text  = 'Click on <strong>two points</strong> on the scale bar representing exactly 1 cm.';
                break;
            case 'DRAWING_AOL':
                title = 'Step 2 — Draw AOL';
                text  = 'Click to add points. Drag to adjust. <strong>Right-click</strong> or <kbd>Backspace</kbd> to undo. Press <kbd>Enter</kbd> or click <em>Confirm Shape</em> when done.';
                confirmStepButton.style.display = 'block';
                break;
            case 'DRAWING_FAT':
                title = 'Step 3 — Measure EGS';
                text  = 'Click <strong>two points</strong> to measure subcutaneous fat thickness.';
                break;
            case 'DONE':
                title = 'Complete!';
                text  = 'Calculation finished.';
                break;
        }
        modalTitleEl.textContent      = title;
        modalInstructionsEl.innerHTML = text;
    }

    // -----------------------------------------------------------------------
    // Modal
    // -----------------------------------------------------------------------
    function openModal() {
        modal.style.display = 'flex';
        state.zoomLevel = 1.0;
        resizeCanvas();
        updateZoom();
    }

    function closeModal() {
        modal.style.display = 'none';
        state.scalePoints = [];
        state.aolPoints   = [];
        state.fatPoints   = [];
    }

    function updateZoom(newZoom) {
        if (newZoom !== undefined) {
            state.zoomLevel = Math.max(0.2, Math.min(5, newZoom));
        }
        zoomLevelEl.textContent = `${Math.round(state.zoomLevel * 100)}%`;
        resizeCanvas();
        draw();
    }

    function resizeCanvas() {
        if (!state.image) return;
        const newW = Math.round(state.image.width  * state.zoomLevel);
        const newH = Math.round(state.image.height * state.zoomLevel);
        if (newW !== state.canvasW || newH !== state.canvasH) {
            modalCanvas.width  = newW;
            modalCanvas.height = newH;
            state.canvasW = newW;
            state.canvasH = newH;
        }
    }

    // -----------------------------------------------------------------------
    // Drawing
    // -----------------------------------------------------------------------
    function draw() {
        if (!state.image) return;
        modalCtx.save();
        modalCtx.setTransform(1, 0, 0, 1, 0, 0);
        modalCtx.clearRect(0, 0, modalCanvas.width, modalCanvas.height);
        modalCtx.scale(state.zoomLevel, state.zoomLevel);
        modalCtx.drawImage(state.image, 0, 0);

        drawPoints(state.scalePoints, 'yellow', 5);
        drawSmoothPolygon(state.aolPoints, '#00ff00');
        drawPoints(state.fatPoints, 'magenta', 5);

        if (state.fatPoints.length === 1 && state.currentStep === 'DRAWING_FAT') {
            drawLine(state.fatPoints[0], state.mousePos, 'rgba(255,0,255,0.5)', 2);
        }
        if (state.fatPoints.length === 2) {
            drawLine(state.fatPoints[0], state.fatPoints[1], 'magenta', 2);
        }
        modalCtx.restore();
    }

    function drawPoints(points, color, radius) {
        const r = radius / state.zoomLevel;
        points.forEach((p, i) => {
            modalCtx.beginPath();
            modalCtx.arc(p.x, p.y, r, 0, 2 * Math.PI);
            modalCtx.fillStyle = (i === state.hoverPointIndex && !state.isDragging) ? 'red' : color;
            modalCtx.fill();
        });
    }

    function drawLine(p1, p2, color, width) {
        modalCtx.beginPath();
        modalCtx.moveTo(p1.x, p1.y);
        modalCtx.lineTo(p2.x, p2.y);
        modalCtx.strokeStyle = color;
        modalCtx.lineWidth   = width / state.zoomLevel;
        modalCtx.stroke();
    }

    function drawSmoothPolygon(points, color) {
        if (points.length < 1) return;
        modalCtx.strokeStyle = color;
        modalCtx.lineWidth   = 2 / state.zoomLevel;
        drawPoints(points, 'white', 5);
        if (points.length > 1) {
            modalCtx.beginPath();
            modalCtx.moveTo(points[0].x, points[0].y);
            for (let i = 0; i < points.length - 1; i++) {
                const mid = {
                    x: (points[i].x + points[i + 1].x) / 2,
                    y: (points[i].y + points[i + 1].y) / 2,
                };
                modalCtx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
            }
            modalCtx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
            modalCtx.stroke();
        }
        if (state.currentStep === 'DRAWING_AOL' && points.length > 0) {
            drawLine(points[points.length - 1], state.mousePos, 'rgba(0,255,0,0.4)', 2);
        }
    }

    // -----------------------------------------------------------------------
    // Mouse handling
    // -----------------------------------------------------------------------
    function getMousePos(event) {
        const rect = modalCanvas.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left)  / state.zoomLevel,
            y: (event.clientY - rect.top) / state.zoomLevel,
        };
    }

    function findPointAt(pos, points, threshold = 10) {
        const t = threshold / state.zoomLevel;
        for (let i = 0; i < points.length; i++) {
            const dx = pos.x - points[i].x, dy = pos.y - points[i].y;
            if (Math.sqrt(dx * dx + dy * dy) < t) return i;
        }
        return -1;
    }

    function getCurrentPoints() {
        switch (state.currentStep) {
            case 'CALIBRATING': return state.scalePoints;
            case 'DRAWING_AOL': return state.aolPoints;
            case 'DRAWING_FAT': return state.fatPoints;
            default: return null;
        }
    }

    function onMouseDown(event) {
        if (event.button !== 0) return;
        state.mousePos = getMousePos(event);
        const points = getCurrentPoints();
        if (!points) return;
        const idx = findPointAt(state.mousePos, points);
        if (idx !== -1) { state.isDragging = true; state.draggedPointIndex = idx; }
    }

    function onMouseMove(event) {
        state.mousePos = getMousePos(event);
        const points = getCurrentPoints();
        if (!points) return;
        if (state.isDragging) {
            points[state.draggedPointIndex] = { ...state.mousePos };
        } else {
            state.hoverPointIndex = findPointAt(state.mousePos, points);
        }
        draw();
    }

    function onMouseUp(event) {
        if (event.button !== 0) return;
        if (state.isDragging) {
            state.isDragging = false; state.draggedPointIndex = -1; draw(); return;
        }
        const points = getCurrentPoints();
        if (!points) return;
        if (findPointAt(state.mousePos, points) !== -1) return;
        points.push({ ...state.mousePos });
        if (state.currentStep === 'CALIBRATING' && points.length === 2) setStep('DRAWING_AOL');
        else if (state.currentStep === 'DRAWING_FAT' && points.length === 2) calculateResults();
        draw();
    }

    function onContextMenu(event) { event.preventDefault(); undoLastPoint(); }

    function getPointOnCurve(points, t) {
        const n = points.length - 1;
        if (n < 1) return points[0];
        const i = Math.min(Math.floor(t * n), n - 1);
        const tSeg = t * n - i;
        return {
            x: points[i].x + (points[i + 1].x - points[i].x) * tSeg,
            y: points[i].y + (points[i + 1].y - points[i].y) * tSeg,
        };
    }

    // -----------------------------------------------------------------------
    // Keyboard shortcuts
    // -----------------------------------------------------------------------
    function onKeyDown(event) {
        if (modal.style.display !== 'flex') return;
        switch (event.key) {
            case 'Escape':    closeModal(); break;
            case 'Backspace':
            case 'Delete':    event.preventDefault(); undoLastPoint(); break;
            case 'Enter':     event.preventDefault(); confirmStep(); break;
        }
    }

    // -----------------------------------------------------------------------
    // Event listeners
    // -----------------------------------------------------------------------
    imageLoader.addEventListener('change', handleImageUpload);
    resetButton.addEventListener('click', resetApplication);
    closeModalButton.addEventListener('click', () => {
        closeModal();
        if (state.analysisMode === 'batch_running') updateMainInstructions();
    });
    confirmStepButton.addEventListener('click', confirmStep);
    zoomInButton.addEventListener('click',  () => updateZoom(state.zoomLevel + 0.2));
    zoomOutButton.addEventListener('click', () => updateZoom(state.zoomLevel - 0.2));
    modalCanvas.addEventListener('mousedown',   onMouseDown);
    modalCanvas.addEventListener('mousemove',   onMouseMove);
    modalCanvas.addEventListener('mouseup',     onMouseUp);
    modalCanvas.addEventListener('contextmenu', onContextMenu);
    modeRadios.forEach(r => r.addEventListener('change', handleModeChange));
    startBatchButton.addEventListener('click', startBatch);
    document.addEventListener('keydown', onKeyDown);
    if (downloadExcelButton) downloadExcelButton.addEventListener('click', downloadExcel);

    // -----------------------------------------------------------------------
    // Init
    // -----------------------------------------------------------------------
    initializeState();
    updateMainInstructions();
});
