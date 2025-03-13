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
    res.send("Server is running and connected to MongoDB Atlas!");
});

// POST for receiving logs from Android App
app.post('/logs', (req, res) => {
    console.log('Received log data:', req.body);
    res.status(200).json({ message: 'Log received successfully' });
});

// Start the Server
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
