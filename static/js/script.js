document.addEventListener('DOMContentLoaded', () => {
    // --- Elementos da Página ---
    const imageLoader = document.getElementById('imageLoader');
    const resetButton = document.getElementById('resetButton');
    const finalImageEl = document.getElementById('finalImage');
    const instructionsEl = document.getElementById('instructions');
    const aolResultEl = document.getElementById('aolResult');
    const fatResultEl = document.getElementById('fatResult');
    const calibrationResultEl = document.getElementById('calibrationResult');
    const modeRadios = document.querySelectorAll('input[name="analysisMode"]');
    const batchControls = document.getElementById('batch-controls');
    const startBatchButton = document.getElementById('startBatchButton');
    const batchCodeInput = document.getElementById('batchCode');
    const fileUploadArea = document.getElementById('file-upload-area');
    const toastContainer = document.getElementById('toast-container');

    // --- Elementos do Modal ---
    const modal = document.getElementById('modal');
    const modalCanvas = document.getElementById('modalCanvas');
    const modalCtx = modalCanvas.getContext('2d');
    const modalTitleEl = document.getElementById('modalTitle');
    const modalInstructionsEl = document.getElementById('modalInstructions');
    const closeModalButton = document.getElementById('close-modal');
    const confirmStepButton = document.getElementById('confirm-step-button');
    const zoomInButton = document.getElementById('zoom-in');
    const zoomOutButton = document.getElementById('zoom-out');
    const zoomLevelEl = document.getElementById('zoom-level');

    // --- Estado da Aplicação ---
    let state = {};

    function initializeState() {
        state = {
            analysisMode: 'individual',
            batchCode: '',
            batchCounter: 1,
            currentStep: 'IDLE',
            image: null,
            filename: null,
            scalePoints: [],
            aolPoints: [],
            fatPoints: [],
            isDragging: false,
            draggedPointIndex: -1,
            hoverPointIndex: -1,
            mousePos: { x: 0, y: 0 },
            zoomLevel: 1.0,
        };
    }
    
    // --- FUNÇÃO PARA NOTIFICAÇÕES ---
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.classList.add('toast', type);
        toast.textContent = message;
        toastContainer.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 500);
        }, 4000);
    }

    // --- Lógica Principal ---
    function resetApplication() {
        initializeState();
        document.querySelector('input[name="analysisMode"][value="individual"]').checked = true;
        batchControls.classList.add('hidden');
        fileUploadArea.classList.remove('hidden');
        imageLoader.value = '';
        finalImageEl.style.display = 'none';
        finalImageEl.src = '';
        aolResultEl.textContent = '-- cm²';
        fatResultEl.textContent = '-- cm';
        calibrationResultEl.textContent = '-- px/cm';
        updateMainInstructions();
        closeModal();
    }

    function handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('file', file);
        fetch('/upload', { method: 'POST', body: formData })
            .then(response => response.json())
            .then(data => {
                if (data.error) { throw new Error(data.error); }
                state.image = new Image();
                state.filename = data.filename;
                state.image.src = data.url;
                state.image.onload = () => {
                    openModal();
                    setStep('CALIBRATING');
                };
            })
            .catch(error => showToast(`Erro no upload: ${error.message}`, 'error'));
    }

    function calculateResults() {
        modalInstructionsEl.innerHTML = "Calculando...";
        const highResAolPoints = [];
        if (state.aolPoints.length > 2) {
             for (let t = 0; t <= 1; t += 0.01) {
                highResAolPoints.push(getPointOnCurve(state.aolPoints, t));
            }
        }
        fetch('/calculate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: state.filename,
                scalePoints: state.scalePoints,
                aolPoints: highResAolPoints,
                fatPoints: state.fatPoints
            })
        })
        .then(response => response.json())
        .then(results => {
            if (results.error) { throw new Error(results.error); }
            
            aolResultEl.textContent = `${results.aol_cm2} cm²`;
            fatResultEl.textContent = `${results.fat_thickness_cm} cm`;
            calibrationResultEl.textContent = `${results.pixels_per_cm} px/cm`;
            
            if (state.analysisMode === 'batch_running') {
                saveToExcel(results.aol_cm2, results.fat_thickness_cm);
            } else {
                setStep('DONE');
                closeModal();
                drawFinalImage();
            }
        })
        .catch(error => {
            showToast(`Erro no cálculo: ${error.message}`, 'error');
            resetApplication();
        });
    }

    function saveToExcel(aol, egs) {
        const imageCode = `${state.batchCode}${String(state.batchCounter).padStart(2, '0')}`;
        fetch('/save_to_excel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                imageCode: imageCode,
                aol: aol,
                egs: egs,
                batchCode: state.batchCode
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            showToast(`${imageCode} salvo com sucesso no Excel!`, 'success');
            state.batchCounter++;
            setStep('DONE');
            closeModal();
            drawFinalImage();
            updateMainInstructions();
        })
        .catch(error => {
            showToast(`Erro ao salvar no Excel: ${error.message}`, 'error');
            resetApplication();
        });
    }

    function confirmStep() {
        if (state.currentStep === 'DRAWING_AOL') {
            if (state.aolPoints.length > 2) {
                setStep('DRAWING_FAT');
            } else {
                showToast("Por favor, desenhe a área (mínimo 3 pontos).", 'error');
            }
        }
    }
    
    function startBatch() {
        const code = batchCodeInput.value.trim().toUpperCase();
        if (code) {
            state.batchCode = code;
            state.batchCounter = 1;
            state.analysisMode = 'batch_running';
            batchControls.classList.add('hidden');
            fileUploadArea.classList.remove('hidden');
            updateMainInstructions();
        } else {
            showToast("Por favor, insira um código para o lote.", 'error');
        }
    }

    // --- Lógica de UI ---
    function setStep(newStep) { state.currentStep = newStep; updateModalInstructions(); draw(); }
    function drawFinalImage() { draw(); finalImageEl.src = modalCanvas.toDataURL('image/png'); finalImageEl.style.display = 'block'; }
    function handleModeChange(event) { state.analysisMode = event.target.value; if (state.analysisMode === 'batch') { state.analysisMode = 'batch_setup'; batchControls.classList.remove('hidden'); fileUploadArea.classList.add('hidden'); } else { batchControls.classList.add('hidden'); fileUploadArea.classList.remove('hidden'); } updateMainInstructions(); }
    function updateMainInstructions() { let title, text; switch(state.analysisMode) { case 'individual': title = 'Modo Individual'; text = 'Carregue uma imagem para análise. O resultado será exibido na tela.'; if(state.currentStep === 'DONE') text = 'Análise concluída!'; break; case 'batch_setup': title = 'Modo em Lote: Configuração'; text = 'Digite um código geral para o seu lote (ex: LOTE01) e clique em "Iniciar Lote". Os resultados serão salvos em um arquivo Excel.'; break; case 'batch_running': const nextImageCode = `${state.batchCode}${String(state.batchCounter).padStart(2, '0')}`; title = `Modo em Lote: Analisando ${state.batchCode}`; text = `Pronto para a imagem <strong>${nextImageCode}</strong>. Carregue o arquivo correspondente.`; if(state.currentStep === 'DONE') text = `Imagem anterior salva. Carregue o arquivo para <strong>${nextImageCode}</strong>.`; break; } instructionsEl.innerHTML = `<h3><i class="fa-solid fa-info-circle"></i> ${title}</h3><p>${text}</p>`; }
    function updateModalInstructions() { let title, text; confirmStepButton.style.display = 'none'; switch(state.currentStep) { case 'CALIBRATING': title = "Passo 1: Calibrar (1 cm)"; text = "Clique em <strong>dois pontos</strong> na escala que representem 1 cm."; break; case 'DRAWING_AOL': title = "Passo 2: Desenhar AOL"; text = "Clique para adicionar pontos. Arraste para ajustar. Quando terminar, clique em <strong>'Confirmar Forma'</strong>."; confirmStepButton.style.display = 'block'; break; case 'DRAWING_FAT': title = "Passo 3: Medir Gordura (EGS)"; text = "Clique em <strong>dois pontos</strong> para medir a espessura de gordura."; break; case 'DONE': title = "Concluído!"; text = "Cálculo finalizado."; break; } modalTitleEl.textContent = title; modalInstructionsEl.innerHTML = text; }
    
    // --- Lógica de Desenho e Mouse ---
    function openModal() { modal.style.display = 'flex'; modalCanvas.width = state.image.width; modalCanvas.height = state.image.height; state.zoomLevel = 1.0; updateZoom(); }
    function closeModal() { modal.style.display = 'none'; state.scalePoints = []; state.aolPoints = []; state.fatPoints = []; }
    function updateZoom(newZoom) { if (newZoom) { state.zoomLevel = Math.max(0.2, Math.min(5, newZoom)); } zoomLevelEl.textContent = `${Math.round(state.zoomLevel * 100)}%`; draw(); }
    function draw() { if (!state.image) return; modalCtx.save(); modalCtx.setTransform(1, 0, 0, 1, 0, 0); modalCtx.clearRect(0, 0, modalCanvas.width, modalCanvas.height); modalCanvas.width = state.image.width * state.zoomLevel; modalCanvas.height = state.image.height * state.zoomLevel; modalCtx.scale(state.zoomLevel, state.zoomLevel); modalCtx.drawImage(state.image, 0, 0); drawPoints(state.scalePoints, 'yellow', 5); drawSmoothPolygon(state.aolPoints, '#00ff00', true); drawPoints(state.fatPoints, 'magenta', 5); if(state.fatPoints.length > 0 && state.currentStep === 'DRAWING_FAT') { drawLine(state.fatPoints[0], state.mousePos, 'rgba(255, 0, 255, 0.5)', 2); } if (state.fatPoints.length === 2) { drawLine(state.fatPoints[0], state.fatPoints[1], 'magenta', 2); } modalCtx.restore(); }
    function drawPoints(points, color, radius) { points.forEach((p, index) => { modalCtx.beginPath(); modalCtx.arc(p.x, p.y, radius / state.zoomLevel, 0, 2 * Math.PI); modalCtx.fillStyle = color; if (index === state.hoverPointIndex && !state.isDragging) { modalCtx.fillStyle = 'red'; } modalCtx.fill(); }); }
    function drawLine(p1, p2, color, width) { modalCtx.beginPath(); modalCtx.moveTo(p1.x, p1.y); modalCtx.lineTo(p2.x, p2.y); modalCtx.strokeStyle = color; modalCtx.lineWidth = width / state.zoomLevel; modalCtx.stroke(); }
    function drawSmoothPolygon(points, color, isInteractive) { if (points.length < 1) return; modalCtx.strokeStyle = color; modalCtx.lineWidth = 2 / state.zoomLevel; drawPoints(points, 'white', 5); if (points.length > 1) { modalCtx.beginPath(); modalCtx.moveTo(points[0].x, points[0].y); for (let i = 0; i < points.length - 1; i++) { const p0 = points[i]; const p1 = points[i + 1]; const midPoint = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }; modalCtx.quadraticCurveTo(p0.x, p0.y, midPoint.x, midPoint.y); } modalCtx.lineTo(points[points.length - 1].x, points[points.length - 1].y); modalCtx.stroke(); } if (isInteractive && state.currentStep === 'DRAWING_AOL' && points.length > 0) { drawLine(points[points.length - 1], state.mousePos, 'rgba(0, 255, 0, 0.5)', 2); } }
    function getMousePos(event) { const rect = modalCanvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) / state.zoomLevel, y: (event.clientY - rect.top) / state.zoomLevel }; }
    function onMouseDown(event) { state.mousePos = getMousePos(event); const points = getCurrentPoints(); if (!points) return; const pointIndex = findPointAt(state.mousePos, points); if (pointIndex !== -1) { state.isDragging = true; state.draggedPointIndex = pointIndex; } }
    function onMouseMove(event) { state.mousePos = getMousePos(event); const points = getCurrentPoints(); if (!points) return; if (state.isDragging) { points[state.draggedPointIndex] = state.mousePos; } else { state.hoverPointIndex = findPointAt(state.mousePos, points); } draw(); }
    function onMouseUp(event) { if (state.isDragging) { state.isDragging = false; state.draggedPointIndex = -1; draw(); return; } handleClick(); }
    function handleClick() { const points = getCurrentPoints(); if (!points) return; points.push(state.mousePos); if (state.currentStep === 'CALIBRATING' && points.length === 2) { setStep('DRAWING_AOL'); } else if (state.currentStep === 'DRAWING_FAT' && points.length === 2) { calculateResults(); } draw(); }
    function findPointAt(pos, points, threshold = 10) { for (let i = 0; i < points.length; i++) { const p = points[i]; const dist = Math.sqrt((pos.x - p.x)**2 + (pos.y - p.y)**2); if (dist < threshold / state.zoomLevel) { return i; } } return -1; }
    function getCurrentPoints() { switch(state.currentStep) { case 'CALIBRATING': return state.scalePoints; case 'DRAWING_AOL': return state.aolPoints; case 'DRAWING_FAT': return state.fatPoints; default: return null; } }
    function getPointOnCurve(points, t) { const n = points.length -1; if (n < 1) return points[0]; const i = Math.floor(t * n); const p0 = points[i]; const p1 = points[i === n ? i : i + 1]; const tSegment = (t * n) - i; return { x: p0.x + (p1.x - p0.x) * tSegment, y: p0.y + (p1.y - p0.y) * tSegment }; }
    
    // --- Event Listeners ---
    imageLoader.addEventListener('change', handleImageUpload);
    resetButton.addEventListener('click', resetApplication);
    closeModalButton.addEventListener('click', () => { closeModal(); if(state.analysisMode === 'batch_running') updateMainInstructions(); });
    confirmStepButton.addEventListener('click', confirmStep);
    zoomInButton.addEventListener('click', () => updateZoom(state.zoomLevel + 0.2));
    zoomOutButton.addEventListener('click', () => updateZoom(state.zoomLevel - 0.2));
    modalCanvas.addEventListener('mousedown', onMouseDown);
    modalCanvas.addEventListener('mousemove', onMouseMove);
    modalCanvas.addEventListener('mouseup', onMouseUp);
    modeRadios.forEach(radio => radio.addEventListener('change', handleModeChange));
    startBatchButton.addEventListener('click', startBatch);

    // --- Inicialização ---
    initializeState();
    updateMainInstructions();
});