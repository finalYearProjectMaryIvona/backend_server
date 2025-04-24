# Traffic Statistic Server

This is the backend server for the **Traffic Statistic App**, designed to support the frontend React application. It handles user authentication, session management, and communication with the **MongoDB database** (local or Atlas-hosted). It exposes a RESTful API for client interaction.

## Technologies
- Node.js  
- Express  
- MongoDB / Mongoose  
- dotenv  
- cors  
- JSON Web Tokens (JWT)

## Features
- Connects to MongoDB (local or MongoDB Atlas)  
- REST API for user and session management
- Handles JSON and image uploads
- Stores logs and traffic data from mobile devices
- Validates new data, give it timestamp and checks for duplicates
- JWT-based secure endpoints for frontend communication  

## To Run

Clone the repository:
```bash
git clone https://github.com/finalYearProjectMaryIvona/backend_server.git
```

Go into project:
```bash
cd kotlin_onnx_backend
```

Install dependencies:
```bash
npm install
npm install jsonwebtoken
```

Make sure there is a `.env` file in the project root and add if it's not already there:
```
PORT=5000
MONGO_URI=mongodb+srv://<your_user>:<your_password>@cluster0.mongodb.net/<your_db_name>?retryWrites=true&w=majority
JWT_SECRET=your_jwt_secret
```
Change:
<your_user> to your MongoDB username

<your_password> to your MongoDB password

<your_db_name> to your database name

To run the server:
```bash
node server.js
```

Server should be running at: [http://localhost:5000](http://localhost:5000).

## Models and Schemas
### User
- email: String (unique)
- userId: UUID
- createdAt: Date
- lastLogin: Date

### Detected Object (Car/Bus/truck)
- sessionId: String
- timestamp: String (formatted)
- objectType: String
- direction: String
- gpsLocation, gpsLatitude, gpsLongitude: GPS info
- userId: String
- isPublic: Boolean
  
### BusImage
- sessionId: String
- timestamp: String
- imageData: Base64 encoded
- eventType: String (entry, exit, etc.)
- gpsLocation, gpsLatitude, gpsLongitude: GPS info
- userId: String

## Authentication
- JWT tokens are generated on login (/web/login) and used for api routes

## API Endpoints
- GET / 
- GET /test-db - List users, test database connection
### Auth
- POST /login – Android/mobile login
- POST /web/login – Web login with JWT return
### Logs and Images
- POST /logs – Log object data from mobile app
- POST /tracking – GPS and session entries
- POST /upload-image – Image uploads (JSON string and image)
- POST /bus-image – Bus images and their data
### Data and Sessions (JWT protected)
- GET /api/sessions – List sessions (filter: mine (private), public, all)
- GET /api/sessions/:sessionId – Full session data
- GET /api/images/:imageId – Get a specific image
### Analytics (JWT protected)
- GET /api/visualizations/traffic-volume
- GET /api/visualizations/vehicle-distribution
- GET /api/visualizations/movement-patterns
- GET /api/visualizations/gps-heatmap

## Features Overview
### Connects to database
- Uses mongoose.connect() to connect to local and cloud-hosted MongoDB
- Environment based URI configuration in `.env`

### User and session management
- User model has email, userId, createdAt and lastLogin

### Frontend communication 
- Uses CORS middleware for requests from frontend [React Web App](https://github.com/finalYearProjectMaryIvona/front_end_web_app.git)
- API endpoints that frontend can use with Axios or Fetch

### JWT authentication system
- JWT used for authentication
- Access token used for secure user sessions

### Secure configuration
- `dotenv` is used to load private data (URI and keys)

## Links
[MongoDB Atlas](https://www.mongodb.com/docs/atlas/)<br/>
[Mongoose](https://mongoosejs.com/docs/guide.html)<br/>
[dotenv](https://www.npmjs.com/package/dotenv)<br/>
[JSON Web Token](https://www.geeksforgeeks.org/json-web-token-jwt/)<br/>
[JWT token](https://www.npmjs.com/package/jsonwebtoken)<br/>
[JWT token guide](https://www.loginradius.com/blog/engineering/guide-to-jwt/)<br/>
[React Web App](https://github.com/finalYearProjectMaryIvona/front_end_web_app)<br/>
