require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

// Connect to MongoDB Atlas
mongoose.connect(MONGO_URI, {})
.then(() => console.log("MongoDB Connected to Atlas"))
.catch(err => console.error("MongoDB Connection Error:", err));

// Test Route on browser on phone
app.get("/", (req, res) => {
    res.send("Server is running and is connected to MongoDB Atlas!");
});

// Schema for different collections
const logSchema = new mongoose.Schema({
    sessionId: String,
    timestamp: String,
    location: String,
    objectType: String,
    direction: String
});

// Create models for different collections
const Bus = mongoose.model("Bus", logSchema);
const Vehicle = mongoose.model("Vehicle", logSchema);
const Other = mongoose.model("Other", logSchema);

// mongoose
const Log = mongoose.model("Log", logSchema);

// POST for receiving logs from Android App
app.post('/logs', async (req, res) => {
    try {
        // Standardize field names since Android sends different formats
        const sessionId = req.body.sessionId || req.body.session_id || "unknown";
        const timestamp = req.body.timestamp || req.body.event_time || new Date().toISOString();
        const location = req.body.location || `${req.body.position_x || 0},${req.body.position_y || 0}`;
        const objectType = req.body.objectType || req.body.object_type || req.body.vehicle_type || "unknown";
        const direction = req.body.direction || "unknown";
        
        console.log("Received log data:");
        console.log("  Session ID: " + sessionId);
        console.log("  Timestamp: " + timestamp);
        console.log("  Location: " + location);
        console.log("  Object Type: " + objectType);
        console.log("  Direction: " + direction);
        console.log("-----------------------------");

        // Choose collection based on object type
        let Model;
        if (objectType.toLowerCase() === "bus") {
            Model = Bus;
        } else if (["car", "truck", "motorcycle", "cup"].includes(objectType.toLowerCase())) {
            Model = Vehicle;
        } else {
            Model = Other;
        }

        // Save data(log) to one of the collections in the database(MongoDB)
        const newLog = new Model({
            sessionId: sessionId,
            timestamp: timestamp,
            location: location,
            objectType: objectType,
            direction: direction
        });

        await newLog.save();
        res.status(200).json({ message: "Log stored successfully in " + Model.collection.name });

    } catch (err) {
        console.error("Error storing log:", err);
        res.status(500).json({ error: "Failed to store log" });
    }
});

// New endpoint for handling tracking with session ID
app.post('/tracking', async (req, res) => {
    try {
        // Standardize field names for better compatibility
        const sessionId = req.body.session_id || "unknown";
        const deviceId = req.body.device_id || req.body.vehicle_id || "unknown";
        const timestamp = req.body.timestamp || new Date().toISOString();
        const location = req.body.location || `${req.body.position_x || 0},${req.body.position_y || 0}`;
        const objectType = req.body.object_type || req.body.vehicle_type || "unknown";
        const direction = req.body.direction || "unknown";
        
        console.log("Received tracking data:");
        console.log("  Session ID: " + sessionId);
        console.log("  Device ID: " + deviceId);
        console.log("  Timestamp: " + timestamp);
        console.log("  Location: " + location);
        console.log("  Object Type: " + objectType);
        console.log("  Direction: " + direction);
        console.log("-----------------------------");

        // Choose collection based on object type
        let Model;
        if (objectType.toLowerCase() === "bus") {
            Model = Bus;
        } else if (["car", "truck", "motorcycle", "cup"].includes(objectType.toLowerCase())) {
            Model = Vehicle;
        } else {
            Model = Other;
        }

        // Save data(log) to one of the collections in the database(MongoDB)
        const newLog = new Model({
            sessionId: sessionId,
            timestamp: timestamp,
            location: location,
            objectType: objectType,
            direction: direction
        });

        await newLog.save();
        res.status(200).json({ 
            message: "Tracking data stored successfully",
            collection: Model.collection.name,
            sessionId: sessionId
        });

    } catch (err) {
        console.error("Error storing tracking data:", err);
        res.status(500).json({ error: "Failed to store tracking data" });
    }
});

// Endpoint specifically for the original API path used in ApiHelper.kt
app.post('/upload-image', async (req, res) => {
    try {
        // Extract data from the multipart form
        const jsonData = JSON.parse(req.body.data || '{}');
        const sessionId = jsonData.session_id || "unknown";
        const objectType = jsonData.vehicle_type || jsonData.object_type || "unknown";
        
        console.log("Received image upload with data:");
        console.log("  Session ID: " + sessionId);
        console.log("  Object Type: " + objectType);
        console.log("-----------------------------");
        
        // Choose collection based on object type
        let Model;
        if (objectType.toLowerCase() === "bus") {
            Model = Bus;
        } else if (["car", "truck", "motorcycle", "cup"].includes(objectType.toLowerCase())) {
            Model = Vehicle;
        } else {
            Model = Other;
        }
        
        // Log entry for the image upload (we don't store the actual image in MongoDB)
        const newLog = new Model({
            sessionId: sessionId,
            timestamp: jsonData.timestamp || new Date().toISOString(),
            location: jsonData.location || `${jsonData.position_x || 0},${jsonData.position_y || 0}`,
            objectType: objectType,
            direction: jsonData.direction || "unknown"
        });
        
        await newLog.save();
        res.status(200).json({ 
            message: "Image data stored successfully",
            collection: Model.collection.name,
            sessionId: sessionId
        });
        
    } catch (err) {
        console.error("Error handling image upload:", err);
        res.status(500).json({ error: "Failed to process image upload" });
    }
});

// Start the Server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
