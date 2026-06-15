import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import http from "http";
import { Server } from "socket.io";
import User from "./models/user.model.js";

dotenv.config();

const port = process.env.PORT || 8000;
const mongodbUrl = process.env.MONGODB_URL;

// In your socket server index.js
// Replace connectDb with this:

const connectDb = async () => {
  try {
    await mongoose.connect(mongodbUrl, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
    })
    console.log("db connected")
  } catch (error) {
    console.log("db error:", error)
    // Retry after 5 seconds
    setTimeout(connectDb, 5000)
  }
}

// Add reconnection handler
mongoose.connection.on("disconnected", () => {
  console.log("MongoDB disconnected — reconnecting...")
  setTimeout(connectDb, 3000)
})

mongoose.connection.on("error", (err) => {
  console.log("MongoDB error:", err)
})

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // allow all origins in dev
  },
});

// ADD THIS BLOCK
app.get("/", (req, res) => {
  res.json({
    status: "success",
    message: "RideXO Socket Server Running"
  });
});

app.post("/emit", async (req, res) => {
  const { event, userId, data } = req.body;

  console.log("=== /emit called ===");
  console.log("event:", event);
  console.log("userId:", userId);

  try {
    const user = await User.findById(userId);

    if (!user) {
      console.log("❌ User not found:", userId);
      return res.json({ success: false, reason: "user not found" });
    }

    console.log("✅ User found:", user.name);
    console.log("socketId in DB:", user.socketId);

    if (!user.socketId) {
      console.log("❌ socketId is null — identity was not saved");
      return res.json({ success: false, reason: "no socketId" });
    }

    io.to(user.socketId).emit(event, data);
    console.log("✅ Emitted to socketId:", user.socketId);

    return res.json({ success: true });

  } catch (error) {
    console.log("❌ /emit error:", error);
    return res.json({ success: false });
  }
});

io.on("connection", (socket) => {
  console.log("🔌 New connection:", socket.id);

  socket.on("identity", async (userId) => {
    console.log("=== IDENTITY ===");
    console.log("userId:", userId);
    console.log("socketId:", socket.id);

    if (!userId) {
      console.log("❌ userId is empty/null — skipping");
      return;
    }

    try {
      socket.userId = userId;

      const result = await User.findByIdAndUpdate(
  userId,
  { socketId: socket.id, isOnline: true },
  { returnDocument: 'after' }  // ← replaces { new: true }
);

      if (result) {
        console.log(`✅ Identity saved — ${result.name}, socketId: ${result.socketId}`);
      } else {
        console.log("❌ User not found in DB for userId:", userId);
      }

    } catch (error) {
      console.log("❌ Identity DB error:", error);
    }
  });

  socket.on("update-location", async ({ userId, latitude, longitude }) => {
    try {
      await User.findByIdAndUpdate(userId, {
        location: {
          type: "Point",
          coordinates: [longitude, latitude],
        },
      });
    } catch (error) {
      console.log("update-location error:", error);
    }
  });

  socket.on("join-ride", (bookingId) => {
    socket.join(`ride-${bookingId}`);
    console.log(`Socket ${socket.id} joined ride-${bookingId}`);
  });

  socket.on("driver-Location-Update", ({ bookingId, latitude, longitude }) => {
    io.to(`ride-${bookingId}`).emit("driver-Location", { latitude, longitude });
  });

  socket.on("chat-message", (data) => {
    io.to(`ride-${data.bookingId}`).emit("chat-message", data);
  });

  socket.on("disconnect", async () => {
    console.log("🔌 Disconnected:", socket.id, "userId:", socket.userId);
    if (!socket.userId) return;
    try {
      await User.findByIdAndUpdate(socket.userId, {
        socketId: null,
        isOnline: false,
      });
      console.log("✅ User marked offline:", socket.userId);
    } catch (error) {
      console.log("disconnect DB error:", error);
    }
  });
});

server.listen(port, () => {
  console.log(`Server started on port ${port}`);
  connectDb();
});