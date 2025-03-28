require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(express.json({ limit: '50mb' }));
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

// Schema for different objects
const logSchema = new mongoose.Schema({
    sessionId: String,
    timestamp: String,
    location: String,
    objectType: String,
    direction: String
});

// Schema for bus images
const busImageSchema = new mongoose.Schema({
    sessionId: String,
    timestamp: String,
    imageData: String,    // Base64 encoded image data
    location: String,
    objectType: { type: String, default: "bus" },
    deviceId: String,
    eventType: { type: String, default: "unknown" }
});

// Create models for different collections
const Bus = mongoose.model("Bus", logSchema);
const Vehicle = mongoose.model("Vehicle", logSchema);
const Other = mongoose.model("Other", logSchema);
// Model for bus images
const BusImage = mongoose.model("BusImage", busImageSchema);

// mongoose
const Log = mongoose.model("Log", logSchema);

// Track recently processed objects to avoid duplicates
const recentObjects = new Map();

// Helper function to check if we've recently processed this object
function isRecentlyProcessed(key) {
    const now = Date.now();
    if (recentObjects.has(key)) {
        const lastTime = recentObjects.get(key);
        if (now - lastTime < 10000) { // 10 seconds threshold
            return true;
        }
    }
    recentObjects.set(key, now);
    
    // Clean up old entries every 100 operations
    if (recentObjects.size > 100) {
        for (const [k, v] of recentObjects.entries()) {
            if (now - v > 30000) { // Remove entries older than 30 seconds
                recentObjects.delete(k);
            }
        }
    }
    
    return false;
}

// Helper function to format timestamp consistently
function formatTimestamp(timestamp) {
    if (!timestamp) return new Date().toISOString();
    
    // If timestamp is a number (Unix timestamp in milliseconds), convert it
    if (!isNaN(timestamp)) {
        return new Date(parseInt(timestamp)).toISOString().slice(0, 19).replace('T', ' ');
    }
    
    // If timestamp already has 'T', it's likely an ISO format
    if (typeof timestamp === 'string' && timestamp.includes('T')) {
        return timestamp.slice(0, 19).replace('T', ' ');
    }
    
    // If it's already in the desired format (YYYY-MM-DD HH:MM:SS), return it
    if (typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp)) {
        return timestamp;
    }
    
    // For any other format, try to parse and format
    try {
        return new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ');
    } catch (e) {
        return new Date().toISOString().slice(0, 19).replace('T', ' ');
    }
}

// Helper function to validate and fix location data
function formatLocation(location, posX, posY) {
    if (location && location !== 'null,null' && !location.includes('undefined')) {
        return location;
    }
    
    if (posX !== undefined && posY !== undefined && posX !== null && posY !== null) {
        return `${posX},${posY}`;
    }
    
    return "0,0"; // Default value if no valid location data
}

// POST for receiving logs from Android App
app.post('/logs', async (req, res) => {
    try {
        // Standardize field names since Android sends different formats
        const sessionId = req.body.sessionId || req.body.session_id || "unknown";
        const deviceId = req.body.device_id || req.body.vehicle_id || "unknown";
        const rawTimestamp = req.body.timestamp || req.body.event_time || new Date().toISOString();
        const timestamp = formatTimestamp(rawTimestamp);
        const location = formatLocation(
            req.body.location, 
            req.body.position_x || req.body.exit_position_x, 
            req.body.position_y || req.body.exit_position_y
        );
        const objectType = req.body.objectType || req.body.object_type || req.body.vehicle_type || "unknown";
        const direction = req.body.direction || "unknown";
        
        // Create a unique key for this object to detect duplicates
        const objectKey = `${sessionId}-${objectType}-${deviceId}-${timestamp.substring(0, 16)}`;
        
        // Skip if we've recently processed this object
        if (isRecentlyProcessed(objectKey)) {
            return res.status(200).json({ 
                message: "Duplicate log detected, ignoring",
                status: "skipped" 
            });
        }
        
        console.log("Received log data:");
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
        const rawTimestamp = req.body.timestamp || new Date().toISOString();
        const timestamp = formatTimestamp(rawTimestamp);
        const location = formatLocation(
            req.body.location, 
            req.body.position_x || req.body.exit_position_x, 
            req.body.position_y || req.body.exit_position_y
        );
        const objectType = req.body.object_type || req.body.vehicle_type || "unknown";
        const direction = req.body.direction || "unknown";
        
        // Create a unique key for this object to detect duplicates
        const objectKey = `${sessionId}-${objectType}-${deviceId}-${timestamp.substring(0, 16)}`;
        
        // Skip if we've processed this object
        if (isRecentlyProcessed(objectKey)) {
            return res.status(200).json({ 
                message: "Duplicate tracking data detected, ignoring",
                status: "skipped" 
            });
        }
        
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
        const rawTimestamp = jsonData.timestamp || new Date().toISOString();
        const timestamp = formatTimestamp(rawTimestamp);
        const location = formatLocation(
            jsonData.location, 
            jsonData.position_x || jsonData.exit_position_x, 
            jsonData.position_y || jsonData.exit_position_y
        );
        
        console.log("Received image upload with data:");
        console.log("  Session ID: " + sessionId);
        console.log("  Object Type: " + objectType);
        console.log("  Timestamp: " + timestamp);
        console.log("  Location: " + location);
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
        
        // Log entry for the image upload
        const newLog = new Model({
            sessionId: sessionId,
            timestamp: timestamp,
            location: location,
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

// POST for handling bus images
app.post('/bus-image', async (req, res) => {
    try {
        // Extract data from request
        const sessionId = req.body.session_id || "unknown";
        const deviceId = req.body.device_id || "unknown";
        const rawTimestamp = req.body.timestamp || new Date().toISOString();
        const timestamp = formatTimestamp(rawTimestamp);
        const image_data = req.body.image_data;
        const location = formatLocation(
            req.body.location, 
            req.body.position_x || req.body.exit_position_x, 
            req.body.position_y || req.body.exit_position_y
        );
        // Add support for event type
        const eventType = req.body.event_type || "unknown"; // Can be "entry", "exit", or "continuous"
        
        // Create a unique key for this bus image to detect duplicates
        const imageKey = `busimg-${sessionId}-${deviceId}-${timestamp.substring(0, 16)}`;
        
        console.log("Received bus image data:");
        console.log("  Session ID: " + sessionId);
        console.log("  Device ID: " + deviceId);
        console.log("  Timestamp: " + timestamp);
        console.log("  Location: " + location);
        console.log("  Event Type: " + eventType);
        console.log("  Image data length: " + (image_data ? image_data.length : 0));
        console.log("-----------------------------");
        
        if (!image_data) {
            return res.status(400).json({ error: "No image data provided" });
        }
        
        // Check if we already have this exact image
        const existingImage = await BusImage.findOne({
            sessionId: sessionId,
            deviceId: deviceId,
            timestamp: timestamp
        });
        
        if (existingImage) {
            return res.status(200).json({ 
                message: "Bus image already exists",
                status: "skipped",
                sessionId: sessionId
            });
        }
        
        // Save image data to the bus_images collection
        const newBusImage = new BusImage({
            sessionId: sessionId,
            timestamp: timestamp,
            imageData: image_data,
            location: location,
            objectType: "bus",
            deviceId: deviceId,
            eventType: eventType // Add event type to the document
        });
        
        await newBusImage.save();
        
        // IMPORTANT: Also create a tracking entry for the bus in the Bus collection
        const busTrackingKey = `${sessionId}-bus-${deviceId}-${timestamp.substring(0, 16)}`;
        
        // Skip if we've recently processed this object to avoid duplicates
        if (!isRecentlyProcessed(busTrackingKey)) {
            // Save a tracking entry for this bus to the Bus collection
            const newBusTracking = new Bus({
                sessionId: sessionId,
                timestamp: timestamp,
                location: location,
                objectType: "bus",
                direction: "unknown",
                eventType: eventType // Add event type to the tracking entry
            });
            
            await newBusTracking.save();
            console.log(`Added tracking entry for bus ID: ${deviceId}, Event: ${eventType}`);
            
            // Mark as processed to prevent duplicates
            recentObjects.set(busTrackingKey, Date.now());
        }
        
        res.status(200).json({ 
            message: "Bus image stored successfully",
            collection: "bus_images",
            sessionId: sessionId,
            eventType: eventType
        });
        
    } catch (err) {
        console.error("Error storing bus image:", err);
        res.status(500).json({ error: "Failed to store bus image" });
    }
});

// Start the Server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
