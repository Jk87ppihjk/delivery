// upload.js

const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const path = require('path');

// 1. Configurar Cloudinary usando suas variáveis de ambiente
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// 2. Configurar o Storage (usaremos um buffer de memória para o Multer e depois faremos o upload manual)
const storage = multer.memoryStorage();

// 3. Configurar o Multer
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // Limite de 5MB por arquivo
        files: 10 // Limite de 10 arquivos
    },
    fileFilter: (req, file, cb) => {
        // Validação de tipo de arquivo (PNG e JPG)
        const filetypes = /jpeg|jpg|png/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error("Apenas arquivos .png e .jpg/.jpeg são permitidos."));
    }
});

// 4. Função para enviar um arquivo do Buffer para o Cloudinary
const uploadToCloudinary = (file) => {
    return new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
            { resource_type: "image", folder: "produtos_aldeify" },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        ).end(file.buffer); // O Multer armazena o arquivo no buffer
    });
};

module.exports = { upload, uploadToCloudinary };
