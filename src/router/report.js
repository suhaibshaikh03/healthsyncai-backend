const express = require('express');
const reportRouter = express.Router();
const { Report } = require('../models/Reports');
const { userAuth } = require('../middleware/authmiddle');
const { upload, cloudinary } = require('../cloudinary/cloudinary');
const { analyzeFileBase64 } = require('../gemini-api/gemini');

// ✅ Upload Report - Modified to process file before storing in Cloudinary
reportRouter.post('/upload', userAuth, upload.single('file'), async (req, res) => {
    try {
        // Validate file presence
        if (!req.file) {
            console.error("No file received in upload request");
            return res.status(400).json({ 
                success: false, 
                message: 'File is required' 
            });
        }

        // Validate file size (max 5MB as per multer config)
        if (req.file.size > 5 * 1024 * 1024) {
            console.error("File too large:", req.file.size, "bytes");
            return res.status(400).json({ 
                success: false, 
                message: 'File size exceeds 5MB limit' 
            });
        }

        // Process the file with AI before saving to Cloudinary
        // Access the file buffer directly from req.file
        console.log("Processing file with AI:", req.file.originalname);
        console.log("File size:", req.file.size, "bytes");
        console.log("File mimetype:", req.file.mimetype);

        const base64File = req.file.buffer.toString("base64");
        const mimeType = req.file.mimetype;

        // Validate GEMINI_API_KEY is set
        if (!process.env.GEMINI_API_KEY) {
            console.error("GEMINI_API_KEY is not set in environment variables");
            return res.status(500).json({
                success: false,
                message: 'Server configuration error: AI service unavailable'
            });
        }

        // ✅ AI Insights (process file before storing)
        console.log("Sending file to Gemini AI for analysis...");
        const ai = await analyzeFileBase64(base64File, mimeType);

        console.log("AI analysis result:", ai.ok ? "SUCCESS" : "FAILED");
        if (ai.parsed) {
            console.log("Parsed title:", ai.parsed.title);
            console.log("Parsed summary:", ai.parsed.summary.substring(0, 100) + "...");
        }

        // Check if AI analysis was successful
        if (!ai.ok || !ai.parsed) {
            console.error("AI analysis failed:", ai.parsed?.summary || "Unknown error");
            return res.status(400).json({
                success: false,
                message: ai.parsed?.summary || 'Error analyzing the file. Please make sure it is a valid PDF or image file.'
            });
        }

        // Validate Cloudinary credentials
        if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
            console.error("Cloudinary credentials are not properly configured");
            return res.status(500).json({
                success: false,
                message: 'Server configuration error: Storage service unavailable'
            });
        }

        // Now upload to Cloudinary after AI processing
        console.log("Uploading file to Cloudinary...");
        let uploadResult;
        try {
            uploadResult = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    {
                        resource_type: "raw",
                        folder: "reports",
                        use_filename: true,
                        unique_filename: true
                    },
                    (error, result) => {  // Callback signature: (error, result) for Cloudinary
                        if (error) {
                            console.error("Cloudinary upload error:", error);
                            console.error("Cloudinary error details:", {
                                message: error.message || 'Unknown error',
                                name: error.name || 'Error',
                                http_code: error.http_code || 'N/A'
                            });
                            reject(error);
                        } else {
                            console.log("Cloudinary upload successful:", result.secure_url);
                            resolve(result);
                        }
                    }
                );
                // Stream the buffer to Cloudinary
                uploadStream.end(req.file.buffer);
            });
        } catch (uploadError) {
            console.error("Critical error during Cloudinary upload:", uploadError);
            return res.status(500).json({
                success: false,
                message: 'Error uploading file to storage',
                error: process.env.NODE_ENV === 'production' ? 'Upload failed' : uploadError.message || uploadError
            });
        }

        console.log("Creating report record in database...");
        console.log("Upload result:", {
            secure_url: uploadResult.secure_url,
            public_id: uploadResult.public_id
        });
        console.log("User ID:", req.user._id);
        console.log("AI parsed data:", {
            title: ai?.parsed?.title,
            summary: ai?.parsed?.summary ? ai?.parsed?.summary.substring(0, 50) + "..." : "No summary"
        });

        let report;
        try {
            report = await Report.create({
                user: req.user._id,
                filename: req.file.originalname,
                fileUrl: uploadResult.secure_url,
                public_id: uploadResult.public_id,
                title: ai?.parsed?.title || 'Untitled Report',
                dateSeen: ai?.parsed?.date || new Date().toISOString().split('T')[0], // Use AI-parsed date or current date
                summary: ai?.parsed?.summary || '',
                explanation_en: ai?.parsed?.explanation_en || '',
                explanation_ro: ai?.parsed?.explanation_ro || '',
                suggested_questions: ai?.parsed?.suggested_questions || [],
            });

            console.log("Report created successfully with ID:", report._id);

            // Verify the report was saved properly
            console.log("Saved report details:", {
                id: report._id,
                title: report.title,
                filename: report.filename
            });
        } catch (dbError) {
            console.error("Database error during report creation:", dbError);
            console.error("Database error details:", {
                message: dbError?.message,
                stack: dbError?.stack,
                name: dbError?.name
            });

            // Attempt to delete the uploaded file from Cloudinary if DB insertion fails
            try {
                await cloudinary.uploader.destroy(uploadResult.public_id);
                console.log("Cleaned up Cloudinary file after DB failure");
            } catch (cleanupError) {
                console.error("Failed to cleanup Cloudinary file:", cleanupError);
            }

            return res.status(500).json({
                success: false,
                message: 'Error saving report to database',
                error: process.env.NODE_ENV === 'production' ? 'Upload failed' : dbError.message
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Report uploaded successfully ✅',
            report
        });

    } catch (err) {
        console.error("Upload Error:", err);
        // Log more detailed error information for debugging in Cloud Run
        console.error("Upload Error Details:", {
            message: err.message,
            stack: err.stack,
            name: err.name
        });

        return res.status(500).json({
            success: false,
            message: 'Server error while uploading report',
            error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
        });
    }
});

// ✅ Fetch My Reports (List)
reportRouter.get('/myreports', userAuth, async (req, res) => {
    try {
        const reports = await Report.find({ user: req.user._id }).sort({ createdAt: -1 });
        return res.json({ success: true, reports });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch reports',
            error: error.message
        });
    }
});

// ✅ Delete Report + Cloudinary
reportRouter.delete('/:id', userAuth, async (req, res) => {
    try {
        const report = await Report.findOne({ _id: req.params.id, user: req.user._id });

        if (!report) {
            return res.status(404).json({ success: false, message: 'Report not found' });
        }

        // ✅ Delete image from Cloudinary
        if (report.public_id) {
            await cloudinary.uploader.destroy(report.public_id);
        }

        await Report.findByIdAndDelete(report._id);

        return res.status(200).json({
            success: true,
            message: 'Report deleted successfully from DB & Cloudinary ✅'
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Error while deleting report',
            error: error.message
        });
    }
});

// ✅ Insights Route
reportRouter.get('/insights', userAuth, async (req, res) => {
    try {
        console.log("Fetching insights for user:", req.user._id);
        const reports = await Report.find({ user: req.user._id }).sort({ createdAt: -1 });
        console.log("Found", reports.length, "reports for user");

        const insights = reports.map((r) => {
            console.log("Mapping report:", r.title, "with ID:", r._id);
            return {
                _id: r._id,
                reportTitle: r.title || r.filename,
                summary: r.summary || "No summary available",
                explanation_en: r.explanation_en || "No explanation available",
                explanation_ro: r.explanation_ro || "No explanation available",
            };
        });

        console.log("Returning", insights.length, "insights");
        return res.status(200).json({
            success: true,
            message: 'Insights fetched successfully ✅',
            insights
        });

    } catch (error) {
        console.error("Error fetching insights:", error);
        return res.status(500).json({
            success: false,
            message: 'Server error while fetching insights',
            error: error.message
        });
    }
});

// ✅ Single Report
reportRouter.get('/:id', userAuth, async (req, res) => {
    try {
        const report = await Report.findOne({ _id: req.params.id, user: req.user._id });

        if (!report) {
            return res.status(404).json({ success: false, message: 'Report not found' });
        }

        return res.json({ success: true, report });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

module.exports = { reportRouter };
