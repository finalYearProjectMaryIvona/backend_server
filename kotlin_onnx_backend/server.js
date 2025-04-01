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
    objectType: String,
    direction: String,
    // GPS
    gpsLocation: String,
    gpsLatitude: Number,
    gpsLongitude: Number,
    // User
    userId: String,
    isPublic: { type: Boolean, default: false }
});

// Schema for bus images
const busImageSchema = new mongoose.Schema({
    sessionId: String,
    timestamp: String,
    imageData: String,    // Base64 encoded image data
    objectType: { type: String, default: "bus" },
    deviceId: String,
    eventType: { type: String, default: "unknown" },
    // GPS
    gpsLocation: String,
    gpsLatitude: Number,
    gpsLongitude: Number,
    // User
    userId: String,
    isPublic: { type: Boolean, default: false }
});

// Schema for users
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    userId: { type: String, required: true, unique: true },
    createdAt: { type: Date, default: Date.now },
    lastLogin: { type: Date, default: Date.now }
});

// Models for different collections
const Bus = mongoose.model("Bus", logSchema);
const Vehicle = mongoose.model("Vehicle", logSchema);
const Other = mongoose.model("Other", logSchema);
// Model for bus images
const BusImage = mongoose.model("BusImage", busImageSchema);
// Model for users
const User = mongoose.model("User", userSchema);

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
    try {
        let date;
        
        // Handle null or undefined
        if (!timestamp) {
            return new Date().toISOString().slice(0, 19).replace('T', ' ');
        }
        
        // Handle MongoDB Date objects (they have a getTime method)
        if (timestamp instanceof Date || (typeof timestamp === 'object' && typeof timestamp.getTime === 'function')) {
            date = timestamp;
        }
        else if (!isNaN(timestamp)) {
            date = new Date(parseInt(timestamp));
        }
        else if (typeof timestamp === 'string' && timestamp.includes('T')) {
            return timestamp.slice(0, 19).replace('T', ' ');
        }
        else if (typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp)) {
            return timestamp;
        }
        else {
            date = new Date(timestamp);
        }
        
        // Verify the date is valid
        if (isNaN(date.getTime())) {
            throw new Error('Invalid date');
        }
        
        // Format to YYYY-MM-DD HH:MM:SS
        return date.toISOString().slice(0, 19).replace('T', ' ');
    } catch (e) {
        console.log(`Warning: Could not format timestamp (${e.message}), using current time instead`);
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
        
        if (objectType.toLowerCase() === "bus") {
            return res.status(200).json({ message: "Bus logs are handled separately", status: "skipped" });
        }

        // Create a unique key for this object to detect duplicates
        const objectKey = `${sessionId}-${objectType}-${deviceId}-${timestamp.substring(0, 13)}`;
        
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
        
        // Extract GPS data
        const gpsLocation = req.body.gps_location || "";
        const gpsLatitude = parseFloat(req.body.gps_latitude) || null;
        const gpsLongitude = parseFloat(req.body.gps_longitude) || null;
        
        // Extract user data
        const userId = req.body.user_id || "";
        const isPublic = req.body.is_public === true;
        
        // Skip if GPS data or user ID is missing
        if (!gpsLocation || gpsLocation === "unknown,unknown" || !gpsLatitude || !gpsLongitude || !userId) {
            return res.status(200).json({ 
                message: "Missing GPS data or user ID, skipping",
                status: "skipped" 
            });
        }
        
        // Create a unique key for this object to detect duplicates
        const objectKey = `${sessionId}-${objectType}-${deviceId}-${timestamp.substring(0, 13)}`;
        
        // Skip if we've processed this object
        if (isRecentlyProcessed(objectKey)) {
            return res.status(200).json({ 
                message: "Duplicate tracking data detected, ignoring",
                status: "skipped" 
            });
        }
        
        console.log(" ");
        console.log("-----------------------------");
        console.log("RECEIVED TRACKING DATA:");
        console.log("  Session ID: " + sessionId);
        console.log("  Device ID: " + deviceId);
        console.log("  Timestamp: " + timestamp);
        console.log("  Object Type: " + objectType);
        console.log("  Direction: " + direction);
        console.log("  GPS: " + gpsLocation);
        console.log("  User ID: " + userId);
        console.log("  Public: " + isPublic);
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

        // Save data with new fields to the database
        const newLog = new Model({
            sessionId: sessionId,
            timestamp: timestamp,
            location: location,
            objectType: objectType,
            direction: direction,
            // Add GPS data
            gpsLocation: gpsLocation,
            gpsLatitude: gpsLatitude,
            gpsLongitude: gpsLongitude,
            // Add user data
            userId: userId,
            isPublic: isPublic
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
        
        console.log("*****************************");
        console.log("Received image upload with data:");
        console.log("  Session ID: " + sessionId);
        console.log("  Object Type: " + objectType);
        console.log("  Timestamp: " + timestamp);
        console.log("  Location: " + location);
        console.log("*****************************");
        
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
        
        // Extract GPS data
        const gpsLocation = req.body.gps_location || "";
        const gpsLatitude = parseFloat(req.body.gps_latitude) || null;
        const gpsLongitude = parseFloat(req.body.gps_longitude) || null;
        
        // Extract user data
        const userId = req.body.user_id || "";
        const isPublic = req.body.is_public === true;
        
        // Add support for event type
        const eventType = req.body.event_type || "unknown"; // Can be "entry", "exit", or "continuous"
        
        // Skip if GPS data or user ID is missing
        if (!gpsLocation || gpsLocation === "unknown,unknown" || !gpsLatitude || !gpsLongitude || !userId) {
            return res.status(200).json({ 
                message: "Missing GPS data or user ID, skipping",
                status: "skipped" 
            });
        }
        
        // Create a unique key for this bus image to detect duplicates
        const imageKey = `busimg-${sessionId}-${deviceId}-${timestamp.substring(0, 13)}`;
        
        console.log(" ");
        console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
        console.log("Received BUS IMAGE DATA:");
        console.log("  Session ID: " + sessionId);
        console.log("  Device ID: " + deviceId);
        console.log("  Timestamp: " + timestamp);
        console.log("  Event Type: " + eventType);
        console.log("  GPS: " + gpsLocation);
        console.log("  User ID: " + userId);
        console.log("  Public: " + isPublic);
        console.log("  Image data length: " + (image_data ? image_data.length : 0));
        console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
        
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
        
        // Save image data to the bus_images collection with new fields
        const newBusImage = new BusImage({
            sessionId: sessionId,
            timestamp: timestamp,
            imageData: image_data,
            location: location,
            objectType: "bus",
            deviceId: deviceId,
            eventType: eventType,
            // Add GPS data
            gpsLocation: gpsLocation,
            gpsLatitude: gpsLatitude,
            gpsLongitude: gpsLongitude,
            // Add user data
            userId: userId,
            isPublic: isPublic
        });
        
        await newBusImage.save();
        
        // Also create a tracking entry for the bus in the Bus collection
        const busTrackingKey = `${sessionId}-bus-${deviceId}-${timestamp.substring(0, 13)}`;
        
        // Skip if we've recently processed this object to avoid duplicates
        if (!isRecentlyProcessed(busTrackingKey)) {
            // Save a tracking entry for this bus to the Bus collection with new fields
            const newBusTracking = new Bus({
                sessionId: sessionId,
                timestamp: timestamp,
                objectType: "bus",
                direction: eventType === "exit" ? "outbound" : "inbound", // Set a direction based on event type
                // Add GPS data
                gpsLocation: gpsLocation,
                gpsLatitude: gpsLatitude,
                gpsLongitude: gpsLongitude,
                // Add user data
                userId: userId,
                isPublic: isPublic
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

// POST for login
app.post('/login', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email || !email.includes('@')) {
            console.log("LOGIN ERROR: Invalid email format");
            return res.status(400).json({ error: "Valid email is required" });
        }
        
        console.log(`\n=============================================`);
        console.log(`LOGIN REQUEST for email: ${email}`);
        
        // Check if user already exists
        let user = await User.findOne({ email });
        
        if (user) {
            // Update last login timestamp
            const oldLoginTime = user.lastLogin;
            user.lastLogin = new Date();
            await user.save();
            
            // Format timestamps
            const createdFormatted = formatTimestamp(user.createdAt);
            const oldLoginFormatted = formatTimestamp(oldLoginTime);
            const newLoginFormatted = formatTimestamp(user.lastLogin);
            
            console.log(`EXISTING USER FOUND in database:`);
            console.log(`  User ID: ${user.userId}`);
            console.log(`  Email: ${user.email}`);
            console.log(`  Created: ${createdFormatted}`);
            console.log(`  Last login updated: ${oldLoginFormatted} → ${newLoginFormatted}`);
            console.log(`=============================================\n`);
            
            return res.status(200).json({ 
                message: "Login successful", 
                user_id: user.userId 
            });
        } else {
            // Create new user
            const userId = require('crypto').randomUUID();
            const now = new Date();
            
            user = new User({
                email,
                userId,
                createdAt: now,
                lastLogin: now
            });
            
            await user.save();
            
            // Format timestamp
            const createdFormatted = formatTimestamp(now);
            
            console.log(`NEW USER CREATED in database:`);
            console.log(`  User ID: ${userId}`);
            console.log(`  Email: ${email}`);
            console.log(`  Created: ${createdFormatted}`);
            console.log(`=============================================\n`);
            
            return res.status(201).json({ 
                message: "User created", 
                user_id: userId 
            });
        }
    } catch (err) {
        console.error("LOGIN ERROR:", err);
        console.log(`=============================================\n`);
        res.status(500).json({ error: "Failed to process login" });
    }
});

async function cleanupIncompleteEntries() {
    try {
        console.log("Starting cleanup of incomplete entries...");
        
        // Find and delete bus entries with missing GPS or user data
        const busResult = await Bus.deleteMany({ 
            $or: [
                { gpsLocation: { $in: ["", "unknown,unknown", null] } },
                { gpsLatitude: null },
                { gpsLongitude: null },
                { userId: "" }
            ]
        });
        
        console.log(`Deleted ${busResult.deletedCount} incomplete bus entries`);
        
        // Find and delete vehicle entries with missing GPS or user data
        const vehicleResult = await Vehicle.deleteMany({ 
            $or: [
                { gpsLocation: { $in: ["", "unknown,unknown", null] } },
                { gpsLatitude: null },
                { gpsLongitude: null },
                { userId: "" }
            ]
        });
        
        console.log(`Deleted ${vehicleResult.deletedCount} incomplete vehicle entries`);
        
        // Find and delete other entries with missing GPS or user data
        const otherResult = await Other.deleteMany({ 
            $or: [
                { gpsLocation: { $in: ["", "unknown,unknown", null] } },
                { gpsLatitude: null },
                { gpsLongitude: null },
                { userId: "" }
            ]
        });
        
        console.log(`Deleted ${otherResult.deletedCount} incomplete other entries`);
        
        // Find and delete bus image entries with missing GPS or user data
        const busImageResult = await BusImage.deleteMany({ 
            $or: [
                { gpsLocation: { $in: ["", "unknown,unknown", null] } },
                { gpsLatitude: null },
                { gpsLongitude: null },
                { userId: "" }
            ]
        });
        
        console.log(`Deleted ${busImageResult.deletedCount} incomplete bus image entries`);
        
        console.log("Cleanup complete.");
    } catch (err) {
        console.error("Error cleaning up incomplete entries:", err);
    }
}

// Add a test route to check database connection and list users
app.get("/test-db", async (req, res) => {
    try {
        // Check database connection
        const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
        
        // Get count of users
        const userCount = await User.countDocuments();
        
        // Get all users (limit to 10 for safety)
        const users = await User.find().limit(10);
        
        res.json({
            status: 'success',
            dbConnection: dbStatus,
            userCount: userCount,
            users: users.map(user => ({
                userId: user.userId,
                email: user.email,
                createdAt: user.createdAt,
                lastLogin: user.lastLogin
            }))
        });
    } catch (error) {
        console.error("Database test error:", error);
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// Function to verify and initialize the users collection
async function verifyUsersCollection() {
    try {
        console.log("\n---------------------------------------------");
        console.log("CHECKING USERS COLLECTION:");
        
        // Check if User model is working correctly
        const userCount = await User.countDocuments();
        console.log(`Found ${userCount} users in database`);
        
        if (userCount === 0) {
            console.log("No users found in the database yet");
        } else {
            // List a few users to verify data structure
            const users = await User.find();
            console.log("Sample users:");
            users.forEach(user => {
                console.log(`  - ${user.email} (${user.userId}), Created: ${user.createdAt}`);
            });
        }
        
        // Check db connection status
        const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
        console.log(`Database connection status: ${dbStatus}`);
        
        console.log("USERS COLLECTION CHECK COMPLETE");
        console.log("---------------------------------------------\n");
    } catch (error) {
        console.error("Error verifying users collection:", error);
    }
}

// Clean existing data
cleanupIncompleteEntries();

// Verify users collection
verifyUsersCollection();

// Start the Server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
