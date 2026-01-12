const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// Configure multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|webp|tiff|bmp/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Only images are allowed!'));
    }
});

// Image Enhancement Logic
async function enhanceImage(inputPath, outputPath, params = {}, overlayData = null) {
    try {
        let image = sharp(inputPath);
        const metadata = await image.metadata();
        
        // Base enhancement
        const newWidth = Math.min(metadata.width * 2, 4000); 
        image = image.resize({ width: newWidth, kernel: sharp.kernel.lanczos3 });
        
        // Apply params if provided
        if (params.sharpen) {
            image = image.sharpen({ sigma: parseFloat(params.sharpen), m1: 1.0, m2: 2.0, x1: 10, y2: 10, y3: 20 });
        } else {
             // Default sharpen for initial upload
             image = image.sharpen({ sigma: 1.5, m1: 1.0, m2: 2.0, x1: 10, y2: 10, y3: 20 });
        }
        
        if (params.brightness) {
            image = image.modulate({ brightness: parseFloat(params.brightness) });
        }
        
        if (params.saturation) {
            // sharp modulate saturation default is 1.0
            image = image.modulate({ saturation: parseFloat(params.saturation) });
        }

        // Apply overlay (drawing) if provided
        if (overlayData) {
            // overlayData is "data:image/png;base64,..."
            const base64Data = overlayData.replace(/^data:image\/\w+;base64,/, "");
            const overlayBuffer = Buffer.from(base64Data, 'base64');
            
            // Resize overlay to match the enhanced image size?
            // The canvas was drawn on the PREVIOUS enhanced image size (or 100% of it).
            // But here we are re-enhancing from SOURCE.
            // Source -> Upscale 2x -> Result.
            // The canvas resolution matches the Result resolution (because we init canvas with img.naturalWidth).
            // So we can just composite directly.
            
            image = image.composite([{ input: overlayBuffer }]);
        }

        await image.toFile(outputPath);
        return true;
    } catch (err) {
        console.error("Error processing image:", err);
        return false;
    }
}

app.post('/upload', upload.array('files', 50), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).send('No files uploaded.');
    }
    const processedFiles = [];
    for (const file of req.files) {
        const inputPath = file.path;
        const filename = path.basename(file.originalname, path.extname(file.originalname));
        const ext = path.extname(file.originalname);
        const outputFilename = `enhanced_${filename}_${Date.now()}${ext}`;
        const outputPath = path.join(__dirname, 'public/results', outputFilename);
        
        // Initial enhancement with defaults
        const success = await enhanceImage(inputPath, outputPath);
        
        if (success) {
            processedFiles.push({
                original: file.originalname,
                source_filename: path.basename(inputPath), // Store temp filename
                enhanced: outputFilename,
                url: `/results/${outputFilename}`
            });
        }
    }
    res.json({ processed_files: processedFiles });
});

app.post('/reprocess', async (req, res) => {
    const { targetFilename, overlay } = req.body;
    
    if (!targetFilename || !overlay) {
        return res.status(400).json({ error: 'Missing filename or overlay data' });
    }

    const targetPath = path.join(__dirname, 'public/results', targetFilename);

    // Check if target exists
    if (!fs.existsSync(targetPath)) {
        return res.status(404).json({ error: 'Target file not found' });
    }

    try {
        // overlayData is "data:image/png;base64,..."
        const base64Data = overlay.replace(/^data:image\/\w+;base64,/, "");
        const overlayBuffer = Buffer.from(base64Data, 'base64');
        
        // Use sharp to composite overlay onto the EXISTING enhanced image
        // We read from targetPath, composite, and write to a buffer first to avoid locking issues
        const buffer = await sharp(targetPath)
            .composite([{ input: overlayBuffer }])
            .toBuffer();
            
        // Write back to file
        await fs.promises.writeFile(targetPath, buffer);
        
        res.json({ success: true, url: `/results/${targetFilename}?t=${Date.now()}` });
    } catch (err) {
        console.error("Error reprocessing image:", err);
        res.status(500).json({ error: 'Processing failed' });
    }
});

app.post('/rename', express.json(), (req, res) => {
    const { oldFilename, newFilename } = req.body;
    
    if (!oldFilename || !newFilename) {
        return res.status(400).json({ error: 'Missing filename' });
    }

    // Basic sanitization to prevent directory traversal
    const safeOld = path.basename(oldFilename);
    const safeNew = path.basename(newFilename);
    
    // Ensure we keep the extension or handle it carefully. 
    // Here we assume user provides the full new name including extension, 
    // or we can enforce the old extension. 
    // Let's enforce the old extension to prevent corruption.
    const oldExt = path.extname(safeOld);
    let finalNewName = safeNew;
    if (path.extname(safeNew) !== oldExt) {
        finalNewName += oldExt;
    }

    const oldPath = path.join(__dirname, 'public/results', safeOld);
    const newPath = path.join(__dirname, 'public/results', finalNewName);

    if (!fs.existsSync(oldPath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    
    if (fs.existsSync(newPath)) {
        return res.status(409).json({ error: 'Filename already exists' });
    }

    fs.rename(oldPath, newPath, (err) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Rename failed' });
        }
        res.json({ 
            success: true, 
            newFilename: finalNewName,
            url: `/results/${finalNewName}`
        });
    });
});

app.get('/download_all', (req, res) => {
    const zip = new AdmZip();
    const resultsDir = path.join(__dirname, 'public/results');
    
    // In a real app, we should only zip files related to the current request/session.
    // For simplicity here, we zip all files in results (or we could pass a list of filenames from frontend).
    // Let's implement a safer way: Frontend should request specific files or we just zip everything for this single-user local demo.
    // To keep it simple for the user, I'll zip everything in results folder that is an image.
    
    fs.readdir(resultsDir, (err, files) => {
        if (err) return res.status(500).send("Error reading results directory");
        
        files.forEach(file => {
            if (file.endsWith('.zip')) return;
            const filePath = path.join(resultsDir, file);
            zip.addLocalFile(filePath);
        });
        
        const zipBuffer = zip.toBuffer();
        res.set('Content-Type', 'application/octet-stream');
        res.set('Content-Disposition', 'attachment; filename=enhanced_images.zip');
        res.set('Content-Length', zipBuffer.length);
        res.send(zipBuffer);
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
