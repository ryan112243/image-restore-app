document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileList = document.getElementById('file-list');
    const uploadBtn = document.getElementById('upload-btn');
    const uploadForm = document.getElementById('upload-form');
    const loadingOverlay = document.getElementById('loading');
    const resultsSection = document.getElementById('results-section');
    const resultsTitle = resultsSection.querySelector('h2');
    const gallery = document.getElementById('gallery');
    const downloadAllBtn = document.getElementById('download-all');
    
    // Edit Modal Elements
    const editModal = document.getElementById('edit-modal');
    const closeModal = editModal.querySelector('.close-modal');
    const editPreview = document.getElementById('edit-preview');
    const editCanvas = document.getElementById('edit-canvas');
    const canvasWrapper = document.querySelector('.canvas-wrapper');
    const applyEditBtn = document.getElementById('apply-edit-btn');
    
    // Tools Elements
    const toolBrushBtn = document.getElementById('tool-brush');
    const toolPanBtn = document.getElementById('tool-pan');
    const brushColorInput = document.getElementById('brush-color');
    const brushSizeInput = document.getElementById('brush-size');
    const brushSizeVal = document.getElementById('brush-size-val');
    const brushEraserBtn = document.getElementById('tool-eraser');
    const brushClearBtn = document.getElementById('brush-clear');
    
    // Zoom Elements
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const zoomFitBtn = document.getElementById('zoom-fit');
    const zoomLevelDisplay = document.getElementById('zoom-level');
    
    let currentEditFile = null;
    let ctx = null;
    let isDrawing = false;
    let isEraser = false;
    let activeTool = 'brush'; // 'brush', 'pan'
    let lastX = 0;
    let lastY = 0;
    
    // Zoom & Pan State
    let scale = 1;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let startPanX = 0;
    let startPanY = 0;

    // Init Canvas
    function initCanvas(img) {
        // Set canvas resolution to match image natural size
        editCanvas.width = img.naturalWidth;
        editCanvas.height = img.naturalHeight;
        ctx = editCanvas.getContext('2d');
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        // Reset state
        activeTool = 'brush';
        isEraser = false;
        resetZoom();
        updateToolUI();
        updateBrushSettings();
    }
    
    function updateBrushSettings() {
        if (!ctx) return;
        ctx.strokeStyle = isEraser ? 'rgba(0,0,0,1)' : brushColorInput.value;
        ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
        ctx.lineWidth = brushSizeInput.value * (editCanvas.width / 1000 * 2); // Scale brush size relative to image
        updateCursor();
    }

    function updateCursor() {
        if (activeTool === 'pan') {
            editCanvas.style.cursor = isPanning ? 'grabbing' : 'grab';
        } else {
            editCanvas.style.cursor = 'crosshair';
        }
    }
    
    function updateToolUI() {
        toolBrushBtn.classList.toggle('active', activeTool === 'brush');
        toolPanBtn.classList.toggle('active', activeTool === 'pan');
        brushEraserBtn.classList.toggle('active', activeTool === 'brush' && isEraser);
        
        // Disable/Enable brush controls based on tool?
        // Maybe just visual feedback is enough.
    }

    // Tool Switching
    toolBrushBtn.addEventListener('click', () => {
        activeTool = 'brush';
        isEraser = false;
        updateToolUI();
        updateBrushSettings();
    });

    toolPanBtn.addEventListener('click', () => {
        activeTool = 'pan';
        updateToolUI();
        updateCursor();
    });

    brushEraserBtn.addEventListener('click', () => {
        activeTool = 'brush';
        isEraser = !isEraser; // Toggle eraser
        updateToolUI();
        updateBrushSettings();
    });

    // Zoom Functions
    function updateTransform() {
        canvasWrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
        zoomLevelDisplay.textContent = `${Math.round(scale * 100)}%`;
    }

    function setZoom(newScale) {
        const prevScale = scale;
        scale = Math.min(Math.max(0.1, newScale), 5); // Limit 10% to 500%
        
        // Adjust pan to zoom towards center? For now simple zoom is fine.
        // Or simple: just update scale.
        
        updateTransform();
    }

    function resetZoom() {
        scale = 1;
        panX = 0;
        panY = 0;
        updateTransform();
    }

    zoomInBtn.addEventListener('click', () => setZoom(scale + 0.1));
    zoomOutBtn.addEventListener('click', () => setZoom(scale - 0.1));
    zoomFitBtn.addEventListener('click', resetZoom);

    // Mouse Wheel Zoom
    editCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom(scale + delta);
    });

    // Brush Event Listeners
    brushColorInput.addEventListener('input', () => {
        if (activeTool === 'brush') {
            isEraser = false;
            updateToolUI();
        }
        updateBrushSettings();
    });
    
    brushSizeInput.addEventListener('input', (e) => {
        brushSizeVal.textContent = e.target.value;
        updateBrushSettings();
    });
    
    brushClearBtn.addEventListener('click', () => {
        if (!ctx) return;
        ctx.clearRect(0, 0, editCanvas.width, editCanvas.height);
    });

    // Drawing & Panning Logic
    function getCanvasCoordinates(e) {
        const rect = editCanvas.getBoundingClientRect();
        const scaleX = editCanvas.width / rect.width;
        const scaleY = editCanvas.height / rect.height;
        
        let clientX, clientY;
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }
        
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY,
            rawX: clientX,
            rawY: clientY
        };
    }

    function handleMouseDown(e) {
        if (!ctx) {
            console.error('Canvas context is null!');
            if (editPreview.complete) initCanvas(editPreview);
            else return;
        }

        if (activeTool === 'pan' || (e.buttons === 4) || (e.code === 'Space')) {
            // Pan Mode
            isPanning = true;
            const coords = getCanvasCoordinates(e);
            startPanX = coords.rawX - panX;
            startPanY = coords.rawY - panY;
            updateCursor();
        } else if (activeTool === 'brush') {
            // Draw Mode
            isDrawing = true;
            const coords = getCanvasCoordinates(e);
            lastX = coords.x;
            lastY = coords.y;
        }
    }

    function handleMouseMove(e) {
        if (isPanning) {
            e.preventDefault();
            const coords = getCanvasCoordinates(e);
            panX = coords.rawX - startPanX;
            panY = coords.rawY - startPanY;
            updateTransform();
        } else if (isDrawing && activeTool === 'brush') {
            e.preventDefault(); // Stop scrolling on touch
            const coords = getCanvasCoordinates(e);
            
            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(coords.x, coords.y);
            ctx.stroke();
            
            lastX = coords.x;
            lastY = coords.y;
        }
    }

    function handleMouseUp() {
        isDrawing = false;
        isPanning = false;
        updateCursor();
    }

    editCanvas.addEventListener('mousedown', handleMouseDown);
    editCanvas.addEventListener('mousemove', handleMouseMove);
    editCanvas.addEventListener('mouseup', handleMouseUp);
    editCanvas.addEventListener('mouseout', handleMouseUp);
    
    editCanvas.addEventListener('touchstart', handleMouseDown);
    editCanvas.addEventListener('touchmove', handleMouseMove);
    editCanvas.addEventListener('touchend', handleMouseUp);

    // Spacebar to pan
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !e.repeat && !editModal.classList.contains('hidden')) {
            editCanvas.style.cursor = 'grab';
        }
    });
    
    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            updateCursor();
        }
    });

    // Close Modal Logic
    closeModal.onclick = () => editModal.classList.add('hidden');
    window.onclick = (event) => {
        if (event.target == editModal) {
            editModal.classList.add('hidden');
        }
    }
    
    // Apply Edit Logic
    applyEditBtn.onclick = async () => {
        if (!currentEditFile) return;
        
        // Get canvas data
        const overlayData = editCanvas.toDataURL('image/png');
        
        applyEditBtn.textContent = '處理中...';
        applyEditBtn.disabled = true;
        
        try {
            const response = await fetch('/reprocess', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetFilename: currentEditFile.enhanced, // We only need the target (enhanced) file
                    overlay: overlayData
                })
            });
            
            const result = await response.json();
            
            if (response.ok && result.success) {
                // Update image in gallery
                const img = document.querySelector(`img[src*="${currentEditFile.enhanced}"]`);
                if (img) {
                    img.src = result.url;
                }
                // Refresh preview
                editPreview.src = result.url;
                
                // Clear canvas so we don't see double (the stroke is now baked into the image)
                ctx.clearRect(0, 0, editCanvas.width, editCanvas.height);
                
                editModal.classList.add('hidden');
            } else {
                alert('處理失敗: ' + (result.error || 'Unknown error'));
            }
        } catch (err) {
            console.error(err);
            alert('網路錯誤');
        } finally {
            applyEditBtn.textContent = '套用變更';
            applyEditBtn.disabled = false;
        }
    };

    // Trigger file input when clicking on drop zone
    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    // Handle Drag & Drop events
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
    });

    function highlight(e) {
        dropZone.classList.add('dragover');
    }

    function unhighlight(e) {
        dropZone.classList.remove('dragover');
    }

    dropZone.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        fileInput.files = files; // Update input files
        handleFiles(files);
    }

    fileInput.addEventListener('change', function() {
        handleFiles(this.files);
    });

    function handleFiles(files) {
        fileList.innerHTML = '';
        if (files.length > 0) {
            uploadBtn.disabled = false;
            Array.from(files).forEach(file => {
                const div = document.createElement('div');
                div.className = 'file-item';
                div.textContent = `${file.name} (${formatSize(file.size)})`;
                fileList.appendChild(div);
            });
        } else {
            uploadBtn.disabled = true;
        }
    }

    function formatSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Handle form submit via Fetch API
    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (fileInput.files.length === 0) return;

        loadingOverlay.classList.remove('hidden');
        resultsSection.classList.add('hidden');
        gallery.innerHTML = '';

        const formData = new FormData();
        for (let i = 0; i < fileInput.files.length; i++) {
            formData.append('files', fileInput.files[i]);
        }

        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('Upload failed');
            }

            const data = await response.json();
            renderResults(data.processed_files);
        } catch (error) {
            console.error('Error:', error);
            alert('發生錯誤，請稍後再試。');
        } finally {
            loadingOverlay.classList.add('hidden');
        }
    });

    function renderResults(files) {
        if (!files || files.length === 0) return;

        resultsTitle.textContent = `修復完成 (${files.length})`;
        
        files.forEach(file => {
            const card = document.createElement('div');
            card.className = 'image-card';
            
            // We store the current filename in a data attribute
            card.innerHTML = `
                <div class="image-comparison">
                    <img src="${file.url}" alt="Enhanced ${file.original}" loading="lazy">
                    <span class="badge">已修復</span>
                    <button class="edit-btn" title="編輯參數">✎</button>
                </div>
                <div class="image-info">
                    <p title="點擊重新命名" data-filename="${file.enhanced}">${file.enhanced}</p>
                    <a href="${file.url}" download="${file.enhanced}" class="download-link">下載此張</a>
                </div>
            `;
            
            // Add click-to-rename functionality
            const nameP = card.querySelector('.image-info p');
            const downloadLink = card.querySelector('.download-link');
            const img = card.querySelector('img');
            const editBtn = card.querySelector('.edit-btn');

            // Edit Button Click Handler
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent other clicks
                currentEditFile = file; // Set current context
                
                // Init canvas once image loads
                editPreview.onload = () => {
                    initCanvas(editPreview);
                    editModal.classList.remove('hidden');
                };
                editPreview.src = file.url;
                
                // Handle cached images
                if (editPreview.complete && editPreview.naturalWidth > 0) {
                    initCanvas(editPreview);
                    editModal.classList.remove('hidden');
                }
            });

            nameP.addEventListener('click', () => {
                if (nameP.querySelector('input')) return; // Already editing

                const currentName = nameP.dataset.filename;
                
                const input = document.createElement('input');
                input.type = 'text';
                input.value = currentName;
                input.className = 'rename-input';
                
                // Replace text with input
                nameP.textContent = '';
                nameP.appendChild(input);
                input.focus();
                
                // Handle save on blur or enter
                const saveName = async () => {
                    let newName = input.value.trim();
                    if (!newName || newName === currentName) {
                        nameP.textContent = currentName;
                        return;
                    }

                    try {
                        const response = await fetch('/rename', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ oldFilename: currentName, newFilename: newName })
                        });

                        const result = await response.json();
                        
                        if (response.ok && result.success) {
                            // Update UI
                            const newFilename = result.newFilename;
                            nameP.dataset.filename = newFilename;
                            nameP.textContent = newFilename;
                            
                            // Update download link
                            downloadLink.href = result.url;
                            downloadLink.download = newFilename;
                            
                            // Update image src
                            img.src = `${result.url}?t=${Date.now()}`;
                        } else {
                            alert('重新命名失敗: ' + (result.error || 'Unknown error'));
                            nameP.textContent = currentName;
                        }
                    } catch (err) {
                        console.error(err);
                        alert('網路錯誤，無法重新命名');
                        nameP.textContent = currentName;
                    }
                };

                input.addEventListener('blur', saveName);
                input.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        input.blur();
                    }
                });
                
                // Stop click propagation
                input.addEventListener('click', (e) => e.stopPropagation());
            });

            gallery.appendChild(card);
        });

        resultsSection.classList.remove('hidden');
        
        // Scroll to results
        resultsSection.scrollIntoView({ behavior: 'smooth' });
    }
});