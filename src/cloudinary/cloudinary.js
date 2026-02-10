const cloudinary = require("cloudinary").v2;
const multer = require("multer");


cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Storage for keeping file in memory temporarily for AI processing
const memoryStorage = multer.memoryStorage();

// Create upload instance with memory storage
const upload = multer({
    storage: memoryStorage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        // Accept only certain file types
        if (file.mimetype === 'application/pdf' ||
            file.mimetype === 'image/png' ||
            file.mimetype === 'image/jpeg' ||
            file.mimetype === 'image/jpg') {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PDF, PNG, and JPG files are allowed.'));
        }
    }
});


module.exports = {
    upload,
    cloudinary
}