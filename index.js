const express = require("express");
const app = express();
require("dotenv").config();

const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET);

const cors = require("cors");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.zeenoci.mongodb.net/?appName=Cluster0`;

// ---------------------------------------------------------------------------
// SERVERLESS-SAFE MONGODB CONNECTION
// On Vercel, each invocation may run in a fresh (or frozen/thawed) execution
// context. A client connected once at module load can go stale ("Topology is
// closed") by the time a later request comes in. We cache the client across
// warm invocations, but verify it's alive (via ping) before reusing it, and
// transparently reconnect if it isn't.
// ---------------------------------------------------------------------------
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    try {
      await cachedClient.db("admin").command({ ping: 1 });
      return cachedDb;
    } catch (err) {
      console.log("Cached MongoDB connection is stale, reconnecting...");
      cachedClient = null;
      cachedDb = null;
    }
  }

  const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
    maxPoolSize: 10,
    minPoolSize: 0,
  });

  await client.connect();
  console.log("Connected to MongoDB");

  const db = client.db("hallApps");

  cachedClient = client;
  cachedDb = db;

  return db;
}

// Middleware: make sure we have a live DB connection before any route runs,
// and expose the collections on req.collections so routes don't rely on
// closure variables that could go stale.
app.use(async (req, res, next) => {
  try {
    const db = await connectToDatabase();
    req.db = db;
    req.collections = {
      users: db.collection("users"),
      students: db.collection("students"),
      notices: db.collection("notices"),
      complaints: db.collection("complaints"),
      payments: db.collection("payments"),
      canteenMenu: db.collection("canteenMenu"),
      canteenFeedback: db.collection("canteenFeedback"),
      events: db.collection("events"),
      applications: db.collection("hallApplications"),
      seats: db.collection("hallSeats"),
      settings: db.collection("appSettings"),
    };
    next();
  } catch (err) {
    console.error("Database connection error:", err);
    res.status(503).json({ message: "Database connection failed. Please try again." });
  }
});

// ---------------------------------------------------------------------------
// AUTH ROUTES
// ---------------------------------------------------------------------------

// Signup - Pw-based auth
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { users } = req.collections;
    const { fullName, email, phone, password, role } = req.body;

    if (!fullName || !email || !phone || !password) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const existing = await users.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const uid = `user_${crypto.randomBytes(12).toString("hex")}`;
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      uid,
      fullName,
      email,
      phone,
      password: hashedPassword,
      role: role || "student",
      profilePicture: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        lastLogin: null,
        loginCount: 0,
      },
    };

    const result = await users.insertOne(newUser);

    res.status(201).json({
      id: result.insertedId,
      fullName: newUser.fullName,
      email: newUser.email,
      phone: newUser.phone,
      uid: newUser.uid,
      role: newUser.role,
      createdAt: newUser.createdAt,
    });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ message: "Server error during signup" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { users } = req.collections;
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await users.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid password" });
    }

    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          "metadata.lastLogin": new Date(),
          updatedAt: new Date(),
        },
        $inc: { "metadata.loginCount": 1 },
      }
    );

    res.json({
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      uid: user.uid,
      role: user.role,
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error during login" });
  }
});

// Get user profile by UID
app.get("/api/auth/profile/:uid", async (req, res) => {
  try {
    const { users } = req.collections;
    const user = await users.findOne({ uid: req.params.uid });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      uid: user.uid,
      role: user.role,
      profilePicture: user.profilePicture,
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.error("Profile error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Firebase login then role fetch
app.get("/api/auth/me", async (req, res) => {
  try {
    const { users } = req.collections;
    const { email } = req.query;
    const user = await users.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({
      _id: user._id,
      name: user.fullName,
      email: user.email,
      role: user.role,
      subRole: user.subRole || null,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------------
// ADMIN
// ---------------------------------------------------------------------------

app.get("/api/admin/students", async (req, res) => {
  try {
    const students = await req.collections.students.find().toArray();
    res.json(students);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/admin/students", async (req, res) => {
  try {
    const student = {
      ...req.body,
      createdAt: new Date(),
    };
    const result = await req.collections.students.insertOne(student);
    res.status(201).json({ message: "Student added", studentId: result.insertedId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put("/api/admin/students/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updated = await req.collections.students.updateOne(
      { _id: new ObjectId(id) },
      { $set: req.body }
    );
    res.json({ message: "Student updated", result: updated });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/admin/students/:id", async (req, res) => {
  try {
    const student = await req.collections.students.findOne({ _id: new ObjectId(req.params.id) });
    if (!student) return res.status(404).json({ message: "Student not found" });
    res.json(student);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete("/api/admin/students/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await req.collections.students.deleteOne({ _id: new ObjectId(id) });
    res.json({ message: "Student deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put("/api/admin/allocate-room/:studentId", async (req, res) => {
  try {
    const { roomNumber, seatNumber, hallName } = req.body;
    const result = await req.collections.students.updateOne(
      { _id: new ObjectId(req.params.studentId) },
      { $set: { roomNumber, seatNumber, hallName } }
    );
    res.json({ message: "Room allocated", result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/admin/users", async (req, res) => {
  try {
    const users = await req.collections.users
      .find({}, { projection: { password: 0 } })
      .toArray();
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put("/api/admin/users/:id/role", async (req, res) => {
  try {
    const { role } = req.body;
    const validRoles = ["student", "admin", "accountant", "canteen_manager", "hall_rep"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    await req.collections.users.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { role, updatedAt: new Date() } }
    );
    res.json({ message: "Role updated successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete("/api/admin/users/:id", async (req, res) => {
  try {
    await req.collections.users.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------------
// NOTICE ROUTES
// ---------------------------------------------------------------------------

app.get("/api/notices", async (req, res) => {
  try {
    const notices = await req.collections.notices.find().sort({ createdAt: -1 }).toArray();
    res.json(notices);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/admin/notices", async (req, res) => {
  try {
    const notice = {
      ...req.body,
      createdAt: new Date(),
    };
    const result = await req.collections.notices.insertOne(notice);
    res.status(201).json({ message: "Notice published", noticeId: result.insertedId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put("/api/admin/notices/:id", async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) {
      return res.status(400).json({ message: "Title and content are required" });
    }
    const result = await req.collections.notices.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { title, content, updatedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Notice not found" });
    }
    res.json({ message: "Notice updated" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete("/api/admin/notices/:id", async (req, res) => {
  try {
    await req.collections.notices.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ message: "Notice deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------------
// COMPLAINT ROUTES
// ---------------------------------------------------------------------------

app.post("/api/complaints", async (req, res) => {
  try {
    const complaint = {
      ...req.body,
      status: "pending",
      createdAt: new Date(),
    };
    const result = await req.collections.complaints.insertOne(complaint);
    res.status(201).json({ message: "Complaint submitted", complaintId: result.insertedId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/complaints", async (req, res) => {
  try {
    const complaints = await req.collections.complaints.find().sort({ createdAt: -1 }).toArray();
    res.json(complaints);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/complaints/student/:studentEmail", async (req, res) => {
  try {
    const complaints = await req.collections.complaints
      .find({ studentEmail: req.params.studentEmail })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(complaints);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put("/api/complaints/:id", async (req, res) => {
  try {
    const result = await req.collections.complaints.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { ...req.body, updatedAt: new Date() } }
    );
    res.json({ message: "Complaint updated", result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------------
// CANTEEN MENU ROUTES
// ---------------------------------------------------------------------------

app.get("/api/canteen/menu/today", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const menu = await req.collections.canteenMenu.findOne({ date: today });
    res.json(menu || { message: "No menu posted for today" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/canteen/menu", async (req, res) => {
  try {
    const menus = await req.collections.canteenMenu.find().sort({ date: -1 }).toArray();
    res.json(menus);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/canteen/menu", async (req, res) => {
  try {
    const { canteenMenu } = req.collections;
    const existing = await canteenMenu.findOne({ date: req.body.date });
    if (existing) {
      await canteenMenu.updateOne(
        { date: req.body.date },
        { $set: { ...req.body, updatedAt: new Date() } }
      );
      return res.json({ message: "Menu updated for " + req.body.date });
    }

    const menu = { ...req.body, createdAt: new Date() };
    const result = await canteenMenu.insertOne(menu);
    res.status(201).json({ message: "Menu posted", menuId: result.insertedId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/canteen/feedback", async (req, res) => {
  try {
    const feedback = { ...req.body, createdAt: new Date() };
    await req.collections.canteenFeedback.insertOne(feedback);
    res.status(201).json({ message: "Feedback submitted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/canteen/feedback", async (req, res) => {
  try {
    const feedbacks = await req.collections.canteenFeedback
      .find()
      .sort({ createdAt: -1 })
      .toArray();
    res.json(feedbacks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete("/api/canteen/menu/:id", async (req, res) => {
  try {
    await req.collections.canteenMenu.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ message: "Menu deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/canteen/menu/date/:date", async (req, res) => {
  try {
    const menu = await req.collections.canteenMenu.findOne({ date: req.params.date });
    res.json(menu || { message: "No menu for this date" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------------
// HALL REP / EVENTS ROUTES
// ---------------------------------------------------------------------------

app.get("/api/events", async (req, res) => {
  try {
    const events = await req.collections.events.find().sort({ date: -1 }).toArray();
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/events", async (req, res) => {
  try {
    const event = { ...req.body, createdAt: new Date() };
    const result = await req.collections.events.insertOne(event);
    res.status(201).json({ message: "Event created", eventId: result.insertedId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put("/api/events/:id", async (req, res) => {
  try {
    await req.collections.events.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { ...req.body, updatedAt: new Date() } }
    );
    res.json({ message: "Event updated" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete("/api/events/:id", async (req, res) => {
  try {
    await req.collections.events.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ message: "Event deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.patch("/api/events/:id/activity", async (req, res) => {
  try {
    await req.collections.events.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { activityUpdate: req.body.activityUpdate, updatedAt: new Date() } }
    );
    res.json({ message: "Activity updated" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------------
// STUDENT PROFILE
// ---------------------------------------------------------------------------

app.get("/api/student/profile/:email", async (req, res) => {
  try {
    const { students, users } = req.collections;
    let student = await students.findOne({ email: req.params.email });

    if (!student) {
      const user = await users.findOne({ email: req.params.email });
      if (!user) return res.status(404).json({ message: "Student not found" });

      return res.json({
        name: user.fullName,
        email: user.email,
        phone: user.phone,
        studentId: null,
        department: null,
        session: null,
        hallName: null,
        roomNumber: null,
        seatNumber: null,
        _fromUsers: true,
      });
    }

    res.json(student);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------------
// APPLICATION WINDOW SETTINGS
// ---------------------------------------------------------------------------

app.get("/api/application-settings", async (req, res) => {
  try {
    const settings = await req.collections.settings.findOne({ key: "hallApplication" });
    if (!settings) {
      return res.json({
        isOpen: false,
        startDate: null,
        endDate: null,
        fee: 0,
        mode: "auto",
      });
    }
    const now = new Date();
    let isOpen;
    if (settings.mode === "manual") {
      isOpen = !!settings.manualOpen;
    } else {
      isOpen =
        !!(settings.startDate && settings.endDate) &&
        now >= new Date(settings.startDate) &&
        now <= new Date(settings.endDate);
    }
    res.json({ ...settings, isOpen });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put("/api/admin/application-settings", async (req, res) => {
  try {
    const { startDate, endDate, fee, mode, manualOpen } = req.body;
    await req.collections.settings.updateOne(
      { key: "hallApplication" },
      {
        $set: {
          key: "hallApplication",
          startDate: startDate || null,
          endDate: endDate || null,
          fee: Number(fee) || 0,
          mode: mode === "manual" ? "manual" : "auto",
          manualOpen: !!manualOpen,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    res.json({ message: "Settings updated" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------------
// SEAT INVENTORY
// ---------------------------------------------------------------------------

app.get("/api/admin/seats", async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const seats = await req.collections.seats
      .find(filter)
      .sort({ hallName: 1, roomNumber: 1, seatNumber: 1 })
      .toArray();
    res.json(seats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/admin/seats", async (req, res) => {
  try {
    const { hallName, roomNumber, seatNumber } = req.body;
    if (!hallName || !roomNumber || !seatNumber) {
      return res
        .status(400)
        .json({ message: "hallName, roomNumber, seatNumber are required" });
    }
    const existing = await req.collections.seats.findOne({ hallName, roomNumber, seatNumber });
    if (existing) return res.status(400).json({ message: "That seat already exists" });

    const seat = {
      hallName,
      roomNumber,
      seatNumber,
      status: "vacant",
      occupiedBy: null,
      createdAt: new Date(),
    };
    const result = await req.collections.seats.insertOne(seat);
    res.status(201).json({ message: "Seat added", seatId: result.insertedId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete("/api/admin/seats/:id", async (req, res) => {
  try {
    const seat = await req.collections.seats.findOne({ _id: new ObjectId(req.params.id) });
    if (seat?.status === "occupied") {
      return res.status(400).json({ message: "Cannot remove an occupied seat" });
    }
    await req.collections.seats.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ message: "Seat removed" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------------
// STUDENT: SUBMIT / VIEW APPLICATION
// ---------------------------------------------------------------------------

app.get("/api/applications/me/:email", async (req, res) => {
  try {
    const application = await req.collections.applications.findOne(
      { studentEmail: req.params.email },
      { sort: { createdAt: -1 } }
    );
    res.json(application || null);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/applications", async (req, res) => {
  try {
    const { applications, students, settings: settingsCol, payments } = req.collections;

    const settings = await settingsCol.findOne({ key: "hallApplication" });
    const now = new Date();
    let isOpen = false;
    if (settings) {
      isOpen =
        settings.mode === "manual"
          ? !!settings.manualOpen
          : !!(settings.startDate && settings.endDate) &&
            now >= new Date(settings.startDate) &&
            now <= new Date(settings.endDate);
    }
    if (!isOpen) {
      return res.status(400).json({ message: "Hall applications are currently closed" });
    }

    const { studentEmail } = req.body;
    if (!studentEmail) {
      return res.status(400).json({ message: "studentEmail is required" });
    }

    // Already has a seat? Block re-application.
    const existingSeat = await students.findOne({
      email: studentEmail,
      roomNumber: { $exists: true, $ne: null, $ne: "" },
    });
    if (existingSeat) {
      return res.status(400).json({
        message: "You already have a hall seat allocated. You cannot apply again.",
      });
    }

    // Already has a pending/approved application? Block duplicate.
    const existing = await applications.findOne({
      studentEmail,
      status: { $in: ["pending", "approved"] },
    });
    if (existing) {
      return res.status(400).json({ message: "You already have an active application" });
    }

    const application = {
      ...req.body,
      status: "pending",
      paymentStatus: "unpaid",
      fee: settings?.fee || 0,
      createdAt: new Date(),
    };
    const result = await applications.insertOne(application);

    // DO NOT create payment record yet — it will be created when admin approves the application
    // This ensures the payment button only appears after admin approval

    res.status(201).json({
      message: "Application submitted",
      applicationId: result.insertedId,
      fee: application.fee,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// REVIEW APPLICATIONS
app.get("/api/admin/applications", async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const apps = await req.collections.applications.find(filter).sort({ createdAt: -1 }).toArray();
    res.json(apps);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Approve — mark application as approved, optionally pre-select seat
app.put("/api/admin/applications/:id/approve", async (req, res) => {
  try {
    const { applications, seats, payments } = req.collections;
    const { seatId, eligibilityNotes } = req.body;

    const application = await applications.findOne({ _id: new ObjectId(req.params.id) });
    if (!application) return res.status(404).json({ message: "Application not found" });

    if (application.status === "approved") {
      return res.status(400).json({ message: "Application is already approved" });
    }

    // Validate seat if provided
    let seatDetails = null;
    if (seatId) {
      const seat = await seats.findOne({ _id: new ObjectId(seatId), status: "vacant" });
      if (!seat) return res.status(400).json({ message: "That seat is not available" });
      seatDetails = {
        seatId: seat._id,
        hallName: seat.hallName,
        roomNumber: seat.roomNumber,
        seatNumber: seat.seatNumber,
      };
    }

    // Mark as approved but DON'T assign seat yet — student must pay first
    const updateData = {
      status: "approved",
      eligibilityNotes: eligibilityNotes || "",
      reviewedAt: new Date(),
    };

    if (seatDetails) {
      updateData.selectedSeatId = seatDetails.seatId;
      updateData.selectedHallName = seatDetails.hallName;
      updateData.selectedRoomNumber = seatDetails.roomNumber;
      updateData.selectedSeatNumber = seatDetails.seatNumber;
    }

    await applications.updateOne(
      { _id: application._id },
      { $set: updateData }
    );

    // Create payment record NOW (so student sees payment button after approval)
    // Check if payment record already exists to avoid duplicates
    const existingPayment = await payments.findOne({ applicationId: application._id });
    if (!existingPayment) {
      await payments.insertOne({
        applicationId: application._id,
        studentId: application.studentId || null,
        studentName: application.studentName || null,
        email: application.studentEmail,
        uid: application.uid || null,
        amount: application.fee || 0,
        scholarshipAmount: 0,
        semester: "Hall Application Fee",
        status: "unpaid",
        source: "hall_application",
        createdAt: new Date(),
      });
    }

    res.json({ 
      message: seatDetails 
        ? "Application approved. Seat reserved pending payment." 
        : "Application approved. Student can now pay the fee."
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Assign seat after payment — called after payment is confirmed
app.put("/api/admin/applications/:id/assign-seat", async (req, res) => {
  try {
    const { applications, seats, students } = req.collections;
    const { seatId } = req.body;
    if (!seatId) return res.status(400).json({ message: "seatId is required" });

    const application = await applications.findOne({ _id: new ObjectId(req.params.id) });
    if (!application) return res.status(404).json({ message: "Application not found" });

    if (application.status !== "approved") {
      return res.status(400).json({ message: "Application must be approved first" });
    }

    if (application.paymentStatus !== "paid") {
      return res.status(400).json({ message: "Payment not completed yet" });
    }

    const seat = await seats.findOne({ _id: new ObjectId(seatId), status: "vacant" });
    if (!seat) return res.status(400).json({ message: "That seat is no longer available" });

    // Mark seat as occupied
    await seats.updateOne(
      { _id: seat._id },
      { $set: { status: "occupied", occupiedBy: application.studentEmail } }
    );

    // Update application with seat details
    await applications.updateOne(
      { _id: application._id },
      {
        $set: {
          hallName: seat.hallName,
          roomNumber: seat.roomNumber,
          seatNumber: seat.seatNumber,
          seatAssignedAt: new Date(),
        },
      }
    );

    // Keep students collection in sync
    await students.updateOne(
      { email: application.studentEmail },
      {
        $set: {
          name: application.studentName,
          email: application.studentEmail,
          studentId: application.studentId,
          department: application.department,
          session: application.session,
          phone: application.phone,
          hallName: seat.hallName,
          roomNumber: seat.roomNumber,
          seatNumber: seat.seatNumber,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    res.json({ message: "Seat assigned successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put("/api/admin/applications/:id/reject", async (req, res) => {
  try {
    const { reason } = req.body;
    await req.collections.applications.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: "rejected", rejectionReason: reason || "", reviewedAt: new Date() } }
    );
    res.json({ message: "Application rejected" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------------
// STRIPE CHECKOUT
// ---------------------------------------------------------------------------

app.post("/api/payments/create-checkout-session", async (req, res) => {
  try {
    const { applicationId, amount, studentEmail, successUrl, cancelUrl } = req.body;
    if (!applicationId || !amount) {
      return res.status(400).json({ message: "applicationId and amount are required" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: studentEmail,
      line_items: [
        {
          price_data: {
            currency: "bdt",
            product_data: { name: "Hall Seat Application Fee" },
            unit_amount: Math.round(Number(amount) * 100),
          },
          quantity: 1,
        },
      ],
      metadata: { applicationId },
      success_url: successUrl || process.env.CLIENT_SUCCESS_SCHEME || "https://example.com/success",
      cancel_url: cancelUrl || process.env.CLIENT_CANCEL_SCHEME || "https://example.com/cancel",
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Generic checkout — works for ANY payment record
app.post("/api/payments/:id/create-checkout-session", async (req, res) => {
  try {
    const payment = await req.collections.payments.findOne({ _id: new ObjectId(req.params.id) });
    if (!payment) return res.status(404).json({ message: "Payment record not found" });
    if (payment.status === "paid") {
      return res.status(400).json({ message: "This payment is already paid" });
    }

    const net = (Number(payment.amount) || 0) - (Number(payment.scholarshipAmount) || 0);
    if (net <= 0) {
      return res.status(400).json({ message: "Nothing due for this payment" });
    }

    const { successUrl, cancelUrl } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: payment.email,
      line_items: [
        {
          price_data: {
            currency: "bdt",
            product_data: { name: payment.semester || "Payment" },
            unit_amount: Math.round(net * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        paymentId: String(payment._id),
        applicationId: payment.applicationId ? String(payment.applicationId) : "",
      },
      success_url: successUrl || process.env.CLIENT_SUCCESS_SCHEME || "https://example.com/success",
      cancel_url: cancelUrl || process.env.CLIENT_CANCEL_SCHEME || "https://example.com/cancel",
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/payments/session-status/:sessionId", async (req, res) => {
  try {
    const { payments, applications, seats, students } = req.collections;
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    const status = session.payment_status; // "paid" | "unpaid"

    if (status === "paid") {
      const { applicationId, paymentId } = session.metadata || {};

      if (paymentId) {
        await payments.updateOne(
          { _id: new ObjectId(paymentId) },
          { $set: { status: "paid", paidAt: new Date(), stripeSessionId: session.id } }
        );
      }

      if (applicationId) {
        const application = await applications.findOne({ _id: new ObjectId(applicationId) });
        
        // Update payment status
        await applications.updateOne(
          { _id: new ObjectId(applicationId) },
          { $set: { paymentStatus: "paid", paidAt: new Date(), stripeSessionId: session.id } }
        );

        // If seat was pre-selected, auto-assign it
        if (application?.selectedSeatId) {
          const seat = await seats.findOne({ _id: application.selectedSeatId });
          
          if (seat && seat.status === "vacant") {
            // Mark seat as occupied
            await seats.updateOne(
              { _id: seat._id },
              { $set: { status: "occupied", occupiedBy: application.studentEmail } }
            );

            // Update application with seat details
            await applications.updateOne(
              { _id: new ObjectId(applicationId) },
              {
                $set: {
                  hallName: seat.hallName,
                  roomNumber: seat.roomNumber,
                  seatNumber: seat.seatNumber,
                  seatAssignedAt: new Date(),
                },
              }
            );

            // Keep students collection in sync
            await students.updateOne(
              { email: application.studentEmail },
              {
                $set: {
                  name: application.studentName,
                  email: application.studentEmail,
                  studentId: application.studentId,
                  department: application.department,
                  session: application.session,
                  phone: application.phone,
                  hallName: seat.hallName,
                  roomNumber: seat.roomNumber,
                  seatNumber: seat.seatNumber,
                  updatedAt: new Date(),
                },
              },
              { upsert: true }
            );
          }
        }

        if (!paymentId) {
          await payments.updateOne(
            { applicationId: new ObjectId(applicationId) },
            { $set: { status: "paid", paidAt: new Date(), stripeSessionId: session.id } }
          );
        }
      }
    }

    res.json({ status });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------------
// PAYMENTS
// ---------------------------------------------------------------------------

app.get("/api/payments", async (req, res) => {
  try {
    const { search, semester, status } = req.query;
    let filter = {};
    if (status) filter.status = status;
    if (semester) filter.semester = semester;
    if (search) {
      filter.$or = [
        { studentName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    const payments = await req.collections.payments.find(filter).sort({ createdAt: -1 }).toArray();
    res.json(payments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/payments/due", async (req, res) => {
  try {
    const dueList = await req.collections.payments.find({ status: "unpaid" }).toArray();
    res.json(dueList);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/payments/summary", async (req, res) => {
  try {
    const all = await req.collections.payments.find().toArray();
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();

    let totalCollected = 0, totalDue = 0, monthlyCollection = 0, pendingCount = 0;

    all.forEach(p => {
      const net = (Number(p.amount) || 0) - (Number(p.scholarshipAmount) || 0);
      if (p.status === "paid") {
        totalCollected += net;
        const paidDate = p.paidAt ? new Date(p.paidAt) : null;
        if (paidDate && paidDate.getMonth() === thisMonth && paidDate.getFullYear() === thisYear) {
          monthlyCollection += net;
        }
      } else {
        totalDue += net;
        pendingCount += 1;
      }
    });

    res.json({ totalCollected, totalDue, monthlyCollection, pendingCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/payments/student/:studentId", async (req, res) => {
  try {
    const id = req.params.studentId;
    const payments = await req.collections.payments
      .find({
        $or: [{ studentId: id }, { email: id }, { uid: id }],
      })
      .toArray();
    res.json(payments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Accountant payment add
app.post("/api/payments", async (req, res) => {
  try {
    const payment = {
      ...req.body,
      createdAt: new Date(),
    };
    const result = await req.collections.payments.insertOne(payment);
    res.status(201).json({ message: "Payment recorded", paymentId: result.insertedId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Accountant payment update (paid/unpaid/scholarship)
app.put("/api/payments/:id", async (req, res) => {
  try {
    const result = await req.collections.payments.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { ...req.body, updatedAt: new Date() } }
    );
    res.json({ message: "Payment updated", result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/payments/report", async (req, res) => {
  try {
    const { month, year, semester } = req.query;
    const all = await req.collections.payments.find().toArray();

    let filtered = all;
    if (month && year) {
      filtered = filtered.filter(p => {
        const d = p.paidAt ? new Date(p.paidAt) : new Date(p.createdAt);
        return d.getMonth() + 1 === Number(month) && d.getFullYear() === Number(year);
      });
    }
    if (semester) {
      filtered = filtered.filter(p => p.semester === semester);
    }

    const paid = filtered.filter(p => p.status === "paid");
    const unpaid = filtered.filter(p => p.status !== "paid");

    const totalCollected = paid.reduce((s, p) => s + ((Number(p.amount) || 0) - (Number(p.scholarshipAmount) || 0)), 0);
    const totalDue = unpaid.reduce((s, p) => s + ((Number(p.amount) || 0) - (Number(p.scholarshipAmount) || 0)), 0);

    res.json({
      totalRecords: filtered.length,
      paidCount: paid.length,
      unpaidCount: unpaid.length,
      totalCollected,
      totalDue,
      records: filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/payments/:id", async (req, res) => {
  try {
    const payment = await req.collections.payments.findOne({ _id: new ObjectId(req.params.id) });
    if (!payment) return res.status(404).json({ message: "Payment not found" });
    res.json(payment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------------
// SERVER START
// Only call app.listen when run directly (local/dev). On Vercel, the
// exported app is used directly as the serverless request handler.
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
  });
}

module.exports = app;
