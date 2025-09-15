import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server } from "socket.io";
import pdf from "html-pdf-node";
import dotenv from "dotenv";

dotenv.config();

// ---------- Environment Variables ----------
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/proctoring";
const CLIENT_URL = (process.env.CLIENT_URL || "*").replace(/\/$/, ""); // ✅ remove trailing slash if present

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

const app = express();
const httpServer = createServer(app);

// ---------- CORS Setup ----------
app.use(
    cors({
        origin: CLIENT_URL,
        methods: ["GET", "POST"],
        credentials: true,
    })
);

app.use(express.json({ limit: "10mb" }));

// ---------- Socket.IO ----------
const io = new Server(httpServer, {
    cors: {
        origin: CLIENT_URL,
        methods: ["GET", "POST"],
        credentials: true,
    },
});

io.on("connection", (socket) => {
    // console.log(`Client connected: ${socket.id}`);

    socket.on("proctor_event", async (event) => {
        try {
            if (!event.candidateId) return;
            event.timestamp = event.timestamp ? new Date(event.timestamp) : new Date();
            const savedEvent = await Log.create(event);
            io.emit("proctor_event", savedEvent);
        } catch (err) {
            socket.emit("error", { message: "Failed to save event" });
        }
    });

    socket.on("disconnect", () => {
        // console.log(`Client disconnected: ${socket.id}`);
    });
});

// ---------- Mongoose Schemas ----------
const logSchema = new mongoose.Schema({
    candidateId: String,
    timestamp: { type: Date, default: Date.now },
    type: String,
    details: Object,
});

const videoSchema = new mongoose.Schema({
    candidateId: String,
    candidateName: String,
    filename: String,
    uploadedAt: { type: Date, default: Date.now },
    durationSeconds: Number,
});

const Log = mongoose.model("Log", logSchema);
const Video = mongoose.model("Video", videoSchema);

// ---------- Multer Setup ----------
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) =>
        cb(null, `${req.body.candidateId}_${Date.now()}_${file.originalname}`),
});
const upload = multer({ storage });

// ---------- Health Check Endpoint ----------
app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        mongo: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
        clientAllowed: CLIENT_URL,
    });
});

// ---------- REST API ----------
app.post("/api/logs", async (req, res) => {
    try {
        const { id, ...logData } = req.body;
        let log;
        if (id) {
            log = await Log.findByIdAndUpdate(id, logData, { new: true, runValidators: true });
            if (!log) log = await Log.create(logData);
        } else {
            log = await Log.create(logData);
        }
        io.emit("proctor_event", log);
        res.status(id ? 200 : 201).json(log);
    } catch (err) {
        res.status(500).json({ error: "Failed to save or update log" });
    }
});

app.post("/api/video", upload.single("video"), async (req, res) => {
    try {
        const videoDoc = await Video.create({
            candidateId: req.body.candidateId,
            candidateName: req.body.candidateName || "",
            filename: req.file.filename,
            durationSeconds: req.body.durationSeconds || null,
        });
        res.json({ status: "ok", file: req.file.filename, videoId: videoDoc._id });
    } catch (err) {
        res.status(500).json({ error: "Failed to save video" });
    }
});

app.get("/api/reports/:candidateId", async (req, res) => {
    try {
        const candidateId = req.params.candidateId;
        const logs = await Log.find({ candidateId }).sort({ timestamp: 1 }).lean();
        const video = await Video.findOne({ candidateId }).sort({ uploadedAt: -1 }).lean();

        const summary = {
            candidateId,
            candidateName: video?.candidateName || "",
            durationSeconds: video?.durationSeconds || null,
            totalEvents: logs.length,
            focusLostCount: logs.filter((l) => l.type === "looking_away").length,
            noFaceCount: logs.filter((l) => l.type === "no_face").length,
            multipleFacesCount: logs.filter((l) => l.type === "multiple_faces").length,
            drowsyCount: logs.filter((l) => l.type === "drowsiness").length,
            suspiciousItems: {},
            rawLogs: logs,
        };

        logs
            .filter((l) => l.type === "suspicious_item")
            .forEach((l) => {
                const item = l.details?.item || "unknown";
                l["deduction"] = 20;
                summary.suspiciousItems[item] = (summary.suspiciousItems[item] || 0) + 1;
            });

        logs
            .filter((l) => l.type === "session_start" || l.type === "session_end")
            .forEach((l) => {
                if (l.type === "session_start") summary.startTime = l.timestamp;
                else if (l.type === "session_end") summary.endTime = l.timestamp;
            });

        let score = 100;
        score -= summary.focusLostCount * 5;
        score -= summary.noFaceCount * 10;
        score -= summary.multipleFacesCount * 15;
        score -= summary.drowsyCount * 10;
        Object.values(summary.suspiciousItems).forEach((itemVal) => (score -= itemVal * 20));
        summary.integrityScore = Math.max(score, 0);

        res.json({ success: true, report: summary.candidateName ? summary : null });
    } catch (err) {
        res.status(500).json({ error: "Failed to generate report" });
    }
});

app.post("/api/generate-pdf", async (req, res) => {
    try {
        const { html } = req.body;
        if (!html) return res.status(400).json({ error: "No HTML provided" });

        const file = { content: html };
        const pdfBuffer = await pdf.generatePdf(file, {
            format: "A4",
            printBackground: true,
            margin: { top: "20px", right: "20px", bottom: "20px", left: "20px" },
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "inline; filename=report.pdf");
        res.send(pdfBuffer);
    } catch (err) {
        res.status(500).send("Failed to generate PDF");
    }
});

// ---------- Connect DB + Start ----------
mongoose
    .connect(MONGO_URI)
    .then(() => {
        httpServer.listen(PORT, () => {
            // console.log(`Server running on port ${PORT}`);
            // console.log(`Allowed Origin: ${CLIENT_URL}`);
        });
    })
    .catch((err) => {
        // console.error("MongoDB connection failed:"
    }, err);
