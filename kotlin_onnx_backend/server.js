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


// FOR WEBSITE
// Web Authentication, return JWT token
app.post('/web/login', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: "Valid email is required" });
        }
        
        console.log(`\n=============================================`);
        console.log(`WEB LOGIN REQUEST for email: ${email}`);
        
        // Check if user already exists
        let user = await User.findOne({ email });
        
        if (user) {
            // Update last login
            user.lastLogin = new Date();
            await user.save();
            
            console.log(`EXISTING USER: ${user.userId}`);
            
            // Get token for web authentication
            const token = generateJwtToken(user.userId, email);
            
            return res.status(200).json({ 
                message: "Login successful", 
                user_id: user.userId,
                token: token
            });
        } else {
            // Create new user
            const userId = require('crypto').randomUUID();
            
            user = new User({
                email,
                userId,
                createdAt: new Date(),
                lastLogin: new Date()
            });
            
            await user.save();
            
            console.log(`NEW WEB USER: ${userId}`);
            
            // Get token for web authentication
            const token = generateJwtToken(userId, email);
            
            return res.status(201).json({ 
                message: "User created", 
                user_id: userId,
                token: token
            });
        }
    } catch (err) {
        console.error("WEB LOGIN ERROR:", err);
        res.status(500).json({ error: "Failed to process login" });
    }
});

// Get token for web authentication
function generateJwtToken(userId, email) {
    const jwt = require('jsonwebtoken');
    const secretKey = process.env.JWT_SECRET || 'your-secret-key';
    
    // Token that expires after 24 hour
    return jwt.sign(
        { userId, email },
        secretKey,
        { expiresIn: '24h' }
    );
}

// Authenticate token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: "Authentication required" });
    
    const jwt = require('jsonwebtoken');
    const secretKey = process.env.JWT_SECRET || 'your-secret-key';
    
    jwt.verify(token, secretKey, (err, user) => {
        if (err) return res.status(403).json({ error: "Invalid or expired token" });
        
        req.user = user; // Attach user to request
        next();
    });
}

// Get sessions by userId or public video
app.get('/api/sessions', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const filter = req.query.filter || 'private';

        let query = {};

        if (filter === 'mine' || filter === 'private') {
            query = { userId: userId };
        } else if (filter === 'public') {
            query = { isPublic: true };
        } else if (filter === 'all') {
            query = { $or: [{ userId: userId }, { isPublic: true }] };
        }

        // Find sessionIds meeting the criteria
        const busSessions = await Bus.distinct('sessionId', query);
        const vehicleSessions = await Vehicle.distinct('sessionId', query);
        const otherSessions = await Other.distinct('sessionId', query);

        const allSessionIds = [...new Set([...busSessions, ...vehicleSessions, ...otherSessions])];

        const sessionDetails = [];

        for (const sessionId of allSessionIds) {
            // Check ownership and public status
            const oldestBus = await Bus.findOne({ sessionId }).sort({ timestamp: 1 });
            const oldestVehicle = await Vehicle.findOne({ sessionId }).sort({ timestamp: 1 });
            const oldestOther = await Other.findOne({ sessionId }).sort({ timestamp: 1 });

            const isPublic = (oldestBus?.isPublic || oldestVehicle?.isPublic || oldestOther?.isPublic) || false;
            const isOwner = (oldestBus?.userId === userId || oldestVehicle?.userId === userId || oldestOther?.userId === userId);

            // ENFORCE filter logic
            if ((filter === 'mine' && !isOwner) || (filter === 'public' && !isPublic)) {
                continue;
            }

            const timestamps = [
                oldestBus?.timestamp, oldestVehicle?.timestamp, oldestOther?.timestamp,
                (await Bus.findOne({ sessionId }).sort({ timestamp: -1 }))?.timestamp,
                (await Vehicle.findOne({ sessionId }).sort({ timestamp: -1 }))?.timestamp,
                (await Other.findOne({ sessionId }).sort({ timestamp: -1 }))?.timestamp
            ].filter(Boolean).sort();

            const startTime = timestamps[0];
            const endTime = timestamps[timestamps.length - 1];

            const sessionUser = await User.findOne({
                userId: oldestBus?.userId || oldestVehicle?.userId || oldestOther?.userId
            });

            const busCount = await Bus.countDocuments({ sessionId });
            const carCount = await Vehicle.countDocuments({ sessionId, objectType: 'car' });
            const truckCount = await Vehicle.countDocuments({ sessionId, objectType: 'truck' });
            const motorcycleCount = await Vehicle.countDocuments({ sessionId, objectType: 'motorcycle' });
            const otherCount = await Other.countDocuments({ sessionId });

            const hasImages = await BusImage.exists({ sessionId });

            //  Get a valid GPS entry (for mapping)
            const gpsEntry = oldestBus || oldestVehicle || oldestOther;
            const gpsLatitude = gpsEntry?.gpsLatitude || null;
            const gpsLongitude = gpsEntry?.gpsLongitude || null;

            sessionDetails.push({
                sessionId,
                startTime,
                endTime,
                duration: startTime && endTime ? getTimeDiff(startTime, endTime) : null,
                user: sessionUser ? {
                    userId: sessionUser.userId,
                    email: sessionUser.email
                } : null,
                objectCounts: {
                    bus: busCount,
                    car: carCount,
                    truck: truckCount,
                    motorcycle: motorcycleCount,
                    other: otherCount,
                    total: busCount + carCount + truckCount + motorcycleCount + otherCount
                },
                hasImages,
                isPublic,
                isOwner,
                gpsLatitude,
                gpsLongitude
            });
        }

        res.json(sessionDetails);
    } catch (err) {
        console.error("Error fetching sessions:", err);
        res.status(500).json({ error: "Failed to fetch sessions" });
    }
});


// Get time difference
function getTimeDiff(start, end) {
    const startDate = new Date(start.replace(' ', 'T'));
    const endDate = new Date(end.replace(' ', 'T'));
    const diffMs = Math.abs(endDate - startDate);
    
    const diffMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

// Get session details
app.get('/api/sessions/:sessionId', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.userId;
        
        // Check if session exists and user has access
        const buses = await Bus.find({ sessionId });
        const vehicles = await Vehicle.find({ sessionId });
        const others = await Other.find({ sessionId });
        
        if (buses.length === 0 && vehicles.length === 0 && others.length === 0) {
            return res.status(404).json({ error: "Session not found" });
        }
        
        // Check access
        const isOwner = buses.some(b => b.userId === userId) || 
                        vehicles.some(v => v.userId === userId) || 
                        others.some(o => o.userId === userId);
                        
        const isPublic = buses.some(b => b.isPublic) || 
                         vehicles.some(v => v.isPublic) || 
                         others.some(o => o.isPublic);
        
        if (!isOwner && !isPublic) {
            return res.status(403).json({ error: "You don't have permission to access this session" });
        }
        
        // Get session data
        const busData = buses.map(formatObjectData);
        const vehicleData = vehicles.map(formatObjectData);
        const otherData = others.map(formatObjectData);
        
        // Get image data if available
        const images = await BusImage.find({ sessionId }).select('-imageData');
        const imageData = images.map(img => ({
            id: img._id,
            timestamp: img.timestamp,
            objectType: img.objectType,
            eventType: img.eventType,
            gpsLocation: img.gpsLocation,
            gpsLatitude: img.gpsLatitude,
            gpsLongitude: img.gpsLongitude,
            // Don't include image data in the list to keep it smaller
            hasImage: true
        }));
        
        res.json({
            sessionId,
            objects: {
                buses: busData,
                vehicles: vehicleData,
                others: otherData
            },
            images: imageData,
            access: {
                isOwner,
                isPublic
            }
        });
        
    } catch (err) {
        console.error("Error fetching session details:", err);
        res.status(500).json({ error: "Failed to fetch session details" });
    }
});

// Format object data
function formatObjectData(obj) {
    return {
        id: obj._id,
        timestamp: obj.timestamp,
        objectType: obj.objectType,
        direction: obj.direction,
        gpsLocation: obj.gpsLocation,
        gpsLatitude: obj.gpsLatitude,
        gpsLongitude: obj.gpsLongitude
    };
}

// Get image by ID
app.get('/api/images/:imageId', authenticateToken, async (req, res) => {
    try {
        const { imageId } = req.params;
        const userId = req.user.userId;
        
        const image = await BusImage.findById(imageId);
        
        if (!image) {
            return res.status(404).json({ error: "Image not found" });
        }
        
        // Check access permissions
        if (image.userId !== userId && !image.isPublic) {
            return res.status(403).json({ error: "You don't have permission to access this image" });
        }
        
        // Return all image data
        res.json({
            id: image._id,
            sessionId: image.sessionId,
            timestamp: image.timestamp,
            objectType: image.objectType,
            deviceId: image.deviceId,
            eventType: image.eventType,
            gpsLocation: image.gpsLocation,
            gpsLatitude: image.gpsLatitude,
            gpsLongitude: image.gpsLongitude,
            imageData: image.imageData
        });
        
    } catch (err) {
        console.error("Error fetching image:", err);
        res.status(500).json({ error: "Failed to fetch image" });
    }
});

// Get traffic data for visualizations
app.get('/api/visualizations/traffic-volume', authenticateToken, async (req, res) => {
    try {
        const { sessionId, timeUnit = 'hour' } = req.query;
        const userId = req.user.userId;
        
        // Check session access
        const buses = await Bus.find({ sessionId });
        const vehicles = await Vehicle.find({ sessionId });
        
        const isOwner = buses.some(b => b.userId === userId) || 
                        vehicles.some(v => v.userId === userId);
                        
        const isPublic = buses.some(b => b.isPublic) || 
                         vehicles.some(v => v.isPublic);
        
        if (!isOwner && !isPublic) {
            return res.status(403).json({ error: "You don't have permission to access this session" });
        }
        
        // Prepare traffic data
        const allObjects = [...buses, ...vehicles];
        
        // Group by time unit
        const volumeData = allObjects.reduce((acc, obj) => {
            const date = new Date(obj.timestamp.replace(' ', 'T'));
            let timeKey;
            
            if (timeUnit === 'minute') {
                // Format: HH:MM
                timeKey = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
            } else if (timeUnit === 'hour') {
                // Format: HH:00
                timeKey = `${date.getHours().toString().padStart(2, '0')}:00`;
            } else if (timeUnit === 'day') {
                // Format: MM-DD
                timeKey = `${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
            }
            
            if (!acc[timeKey]) {
                acc[timeKey] = {
                    timeKey,
                    total: 0,
                    bus: 0,
                    car: 0,
                    truck: 0,
                    motorcycle: 0,
                    other: 0
                };
            }
            
            acc[timeKey].total += 1;
            
            const objType = obj.objectType.toLowerCase();
            if (objType === 'bus') acc[timeKey].bus += 1;
            else if (objType === 'car') acc[timeKey].car += 1;
            else if (objType === 'truck') acc[timeKey].truck += 1;
            else if (objType === 'motorcycle') acc[timeKey].motorcycle += 1;
            else acc[timeKey].other += 1;
            
            return acc;
        }, {});
        
        // Sort by time and turn to array
        const result = Object.values(volumeData).sort((a, b) => a.timeKey.localeCompare(b.timeKey));
        
        res.json(result);
        
    } catch (err) {
        console.error("Error fetching traffic volume data:", err);
        res.status(500).json({ error: "Failed to fetch traffic volume data" });
    }
});

// Get vehicle type distribution
app.get('/api/visualizations/vehicle-distribution', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.query;
        const userId = req.user.userId;
        
        // Check session access
        const buses = await Bus.find({ sessionId });
        const vehicles = await Vehicle.find({ sessionId });
        
        const isOwner = buses.some(b => b.userId === userId) || 
                        vehicles.some(v => v.userId === userId);
                        
        const isPublic = buses.some(b => b.isPublic) || 
                         vehicles.some(v => v.isPublic);
        
        if (!isOwner && !isPublic) {
            return res.status(403).json({ error: "You don't have permission to access this session" });
        }
        
        // Count vehicles of same type
        const busCount = buses.length;
        const carCount = vehicles.filter(v => v.objectType.toLowerCase() === 'car').length;
        const truckCount = vehicles.filter(v => v.objectType.toLowerCase() === 'truck').length;
        const motorcycleCount = vehicles.filter(v => v.objectType.toLowerCase() === 'motorcycle').length;
        const otherCount = vehicles.filter(v => 
            !['car', 'truck', 'motorcycle'].includes(v.objectType.toLowerCase())
        ).length;
        
        res.json([
            { type: 'Bus', count: busCount },
            { type: 'Car', count: carCount },
            { type: 'Truck', count: truckCount },
            { type: 'Motorcycle', count: motorcycleCount },
            { type: 'Other', count: otherCount }
        ]);
        
    } catch (err) {
        console.error("Error fetching vehicle distribution data:", err);
        res.status(500).json({ error: "Failed to fetch vehicle distribution data" });
    }
});

// Get direction
app.get('/api/visualizations/movement-patterns', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.query;
        const userId = req.user.userId;
        
        // Check session access
        const buses = await Bus.find({ sessionId });
        const vehicles = await Vehicle.find({ sessionId });
        
        const isOwner = buses.some(b => b.userId === userId) || 
                        vehicles.some(v => v.userId === userId);
                        
        const isPublic = buses.some(b => b.isPublic) || 
                         vehicles.some(v => v.isPublic);
        
        if (!isOwner && !isPublic) {
            return res.status(403).json({ error: "You don't have permission to access this session" });
        }
        
        // Combine all objects
        const allObjects = [...buses, ...vehicles];
        
        // Group by direction
        const directionData = allObjects.reduce((acc, obj) => {
            const direction = obj.direction || 'Unknown';
            
            if (!acc[direction]) {
                acc[direction] = {
                    direction,
                    count: 0,
                    vehicles: {
                        bus: 0,
                        car: 0,
                        truck: 0,
                        motorcycle: 0,
                        other: 0
                    }
                };
            }
            
            acc[direction].count += 1;
            
            // Count by vehicle type
            const objType = obj.objectType.toLowerCase();
            if (objType === 'bus') acc[direction].vehicles.bus += 1;
            else if (objType === 'car') acc[direction].vehicles.car += 1;
            else if (objType === 'truck') acc[direction].vehicles.truck += 1;
            else if (objType === 'motorcycle') acc[direction].vehicles.motorcycle += 1;
            else acc[direction].vehicles.other += 1;
            
            return acc;
        }, {});
        
        // Convert to array and sort by count
        const result = Object.values(directionData).sort((a, b) => b.count - a.count);
        
        res.json(result);
        
    } catch (err) {
        console.error("Error fetching movement pattern data:", err);
        res.status(500).json({ error: "Failed to fetch movement pattern data" });
    }
});

// Get GPS data for heat maps
app.get('/api/visualizations/gps-heatmap', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.query;
        const userId = req.user.userId;
        
        // Check session access
        const buses = await Bus.find({ sessionId }).select('gpsLatitude gpsLongitude objectType');
        const vehicles = await Vehicle.find({ sessionId }).select('gpsLatitude gpsLongitude objectType');
        
        const isOwner = buses.some(b => b.userId === userId) || 
                        vehicles.some(v => v.userId === userId);
                        
        const isPublic = buses.some(b => b.isPublic) || 
                         vehicles.some(v => v.isPublic);
        
        if (!isOwner && !isPublic) {
            return res.status(403).json({ error: "You don't have permission to access this session" });
        }
        
        // Combine GPS data points
        const allGpsData = [...buses, ...vehicles]
            .filter(obj => obj.gpsLatitude && obj.gpsLongitude) // Remove points with missing GPS
            .map(obj => ({
                lat: obj.gpsLatitude,
                lng: obj.gpsLongitude,
                type: obj.objectType?.toLowerCase() || 'unknown'
            }));
        
        res.json(allGpsData);
        
    } catch (err) {
        console.error("Error fetching GPS data:", err);
        res.status(500).json({ error: "Failed to fetch GPS data" });
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