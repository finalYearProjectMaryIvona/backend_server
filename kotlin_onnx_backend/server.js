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
        console.log("Received log data:");
        console.log("  Session ID: " + req.body.sessionId);
        console.log("  Timestamp: " + req.body.timestamp);
        console.log("  Location: " + req.body.location);
        console.log("  Object Type: " + req.body.objectType);
        console.log("  Direction: " + req.body.direction);
        console.log("-----------------------------");

        // Choose collection based on object type
        let Model;
        if (req.body.objectType.toLowerCase() === "bus") {
            Model = Bus;
        } else if (["car", "truck", "motorcycle", "cup"].includes(req.body.objectType.toLowerCase())) {
            Model = Vehicle;
        } else {
            Model = Other;
        }

        // Save data(log) to one of the collections in the database(MongoDB)
        const newLog = new Model({
            sessionId: req.body.sessionId,
            timestamp: req.body.timestamp,
            location: req.body.location,
            objectType: req.body.objectType,
            direction: req.body.direction
        });

        await newLog.save();
        res.status(200).json({ message: "Log stored successfully" + Model.collection.name });

    } catch (err) {
        console.error("Error storing log:", err);
        res.status(500).json({ error: "Failed to store log" });
    }
});

// Start the Server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
