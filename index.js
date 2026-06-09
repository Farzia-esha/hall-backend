const express = require("express");
const app = express();
const cors = require("cors");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
require("dotenv").config();
const { MongoClient, ServerApiVersion,ObjectId } = require("mongodb");
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.zeenoci.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Try to connect to MongoDB
    await client.connect();
    console.log("✅ Connected to MongoDB");
  } catch (err) {
    console.error("⚠️  MongoDB connection warning:", err.message);
    console.log("⚠️  Continuing without database...");
  }

  const db = client.db("hallApps");

  // ===== COLLECTIONS =====
  const usersCollection = db.collection("users");
  const studentsCollection = db.collection("students");
  const noticesCollection = db.collection("notices");
  const complaintsCollection = db.collection("complaints");
  const paymentsCollection = db.collection("payments");
  const canteenMenuCollection = db.collection("canteenMenu");
  const eventsCollection = db.collection("events");


  // ============================================================
  // AUTH ROUTES (Firebase Integration)
  // ============================================================

  // ✅ Signup - Password-based authentication
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { fullName, email, phone, password, role } = req.body;

      // Validation
      if (!fullName || !email || !phone || !password) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      // Check if user already exists
      const existing = await usersCollection.findOne({ email });
      if (existing) {
        return res.status(400).json({ message: "Email already exists" });
      }

      // Generate UID (unique identifier for frontend)
      const uid = `user_${crypto.randomBytes(12).toString('hex')}`;

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create new user
      const newUser = {
        uid, // Generated UID for frontend
        fullName,
        email,
        phone,
        password: hashedPassword, // Store hashed password
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

      const result = await usersCollection.insertOne(newUser);

      // Return user data (without password)
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

  // ✅ Login - Password verification
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      // Validation
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      // Find user
      const user = await usersCollection.findOne({ email });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid password" });
      }

      // Update last login
      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            "metadata.lastLogin": new Date(),
            updatedAt: new Date(),
          },
          $inc: { "metadata.loginCount": 1 },
        }
      );

      // Return user data
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
      const user = await usersCollection.findOne({ uid: req.params.uid });

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

  // ============================================================
  // ADMIN ROUTES
  // ============================================================

  // সব students দেখো
  app.get("/api/admin/students", async (req, res) => {
    try {
      const students = await studentsCollection.find().toArray();
      res.json(students);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // নতুন student add করো
  app.post("/api/admin/students", async (req, res) => {
    try {
      const student = {
        ...req.body,
        createdAt: new Date(),
      };
      const result = await studentsCollection.insertOne(student);
      res.status(201).json({ message: "Student added", studentId: result.insertedId });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Student update করো
  app.put("/api/admin/students/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const updated = await studentsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: req.body }
      );
      res.json({ message: "Student updated", result: updated });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Student delete করো
  app.delete("/api/admin/students/:id", async (req, res) => {
    try {
      const id = req.params.id;
      await studentsCollection.deleteOne({ _id: new ObjectId(id) });
      res.json({ message: "Student deleted" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Room/Seat allocate করো
  app.put("/api/admin/allocate-room/:studentId", async (req, res) => {
    try {
      const { roomNumber, seatNumber, hallName } = req.body;
      const result = await studentsCollection.updateOne(
        { _id: new ObjectId(req.params.studentId) },
        { $set: { roomNumber, seatNumber, hallName } }
      );
      res.json({ message: "Room allocated", result });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================================
  // NOTICE ROUTES
  // ============================================================

  // সব notices দেখো (student + admin দুজনেই দেখতে পারবে)
  app.get("/api/notices", async (req, res) => {
    try {
      const notices = await noticesCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.json(notices);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin notice publish করবে
  app.post("/api/admin/notices", async (req, res) => {
    try {
      const notice = {
        ...req.body,
        createdAt: new Date(),
      };
      const result = await noticesCollection.insertOne(notice);
      res.status(201).json({ message: "Notice published", noticeId: result.insertedId });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Notice delete করো
  app.delete("/api/admin/notices/:id", async (req, res) => {
    try {
      await noticesCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.json({ message: "Notice deleted" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================================
  // COMPLAINT ROUTES
  // ============================================================

  // Student complaint submit করবে
  app.post("/api/complaints", async (req, res) => {
    try {
      const complaint = {
        ...req.body,
        status: "pending",
        createdAt: new Date(),
      };
      const result = await complaintsCollection.insertOne(complaint);
      res.status(201).json({ message: "Complaint submitted", complaintId: result.insertedId });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin/HallRep সব complaints দেখবে
  app.get("/api/complaints", async (req, res) => {
    try {
      const complaints = await complaintsCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.json(complaints);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Student নিজের complaints দেখবে
  app.get("/api/complaints/student/:studentEmail", async (req, res) => {
    try {
      const complaints = await complaintsCollection
        .find({ studentEmail: req.params.studentEmail })
        .sort({ createdAt: -1 })
        .toArray();
      res.json(complaints);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin complaint resolve/update করবে
  app.put("/api/complaints/:id", async (req, res) => {
    try {
      const result = await complaintsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { ...req.body, updatedAt: new Date() } }
      );
      res.json({ message: "Complaint updated", result });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================================
  // PAYMENT ROUTES (Accountant)
  // ============================================================

  // সব payments দেখো
  app.get("/api/payments", async (req, res) => {
    try {
      const payments = await paymentsCollection.find().toArray();
      res.json(payments);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Due list (unpaid students)
  app.get("/api/payments/due", async (req, res) => {
    try {
      const dueList = await paymentsCollection
        .find({ status: "unpaid" })
        .toArray();
      res.json(dueList);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Student নিজের payment status দেখবে
  app.get("/api/payments/student/:studentId", async (req, res) => {
    try {
      const payments = await paymentsCollection
        .find({ studentId: req.params.studentId })
        .toArray();
      res.json(payments);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Accountant payment add করবে
  app.post("/api/payments", async (req, res) => {
    try {
      const payment = {
        ...req.body,
        createdAt: new Date(),
      };
      const result = await paymentsCollection.insertOne(payment);
      res.status(201).json({ message: "Payment recorded", paymentId: result.insertedId });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Accountant payment update করবে (paid/unpaid/scholarship)
  app.put("/api/payments/:id", async (req, res) => {
    try {
      const result = await paymentsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { ...req.body, updatedAt: new Date() } }
      );
      res.json({ message: "Payment updated", result });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================================
  // CANTEEN MENU ROUTES
  // ============================================================

  // আজকের menu দেখো
  app.get("/api/canteen/menu/today", async (req, res) => {
    try {
      const today = new Date().toISOString().split("T")[0]; // "2024-12-01"
      const menu = await canteenMenuCollection.findOne({ date: today });
      res.json(menu || { message: "No menu posted for today" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // সব menus দেখো
  app.get("/api/canteen/menu", async (req, res) => {
    try {
      const menus = await canteenMenuCollection
        .find()
        .sort({ date: -1 })
        .toArray();
      res.json(menus);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Canteen Manager menu post করবে
  app.post("/api/canteen/menu", async (req, res) => {
    try {
      // same date-এ already আছে কিনা check করো
      const existing = await canteenMenuCollection.findOne({ date: req.body.date });
      if (existing) {
        // থাকলে update করো
        await canteenMenuCollection.updateOne(
          { date: req.body.date },
          { $set: { ...req.body, updatedAt: new Date() } }
        );
        return res.json({ message: "Menu updated for " + req.body.date });
      }

      const menu = { ...req.body, createdAt: new Date() };
      const result = await canteenMenuCollection.insertOne(menu);
      res.status(201).json({ message: "Menu posted", menuId: result.insertedId });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Student feedback দেবে canteen-এ
  app.post("/api/canteen/feedback", async (req, res) => {
    try {
      const feedbackCollection = db.collection("canteenFeedback");
      const feedback = { ...req.body, createdAt: new Date() };
      await feedbackCollection.insertOne(feedback);
      res.status(201).json({ message: "Feedback submitted" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Canteen Manager feedback দেখবে
  app.get("/api/canteen/feedback", async (req, res) => {
    try {
      const feedbackCollection = db.collection("canteenFeedback");
      const feedbacks = await feedbackCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.json(feedbacks);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Menu delete করো
app.delete("/api/canteen/menu/:id", async (req, res) => {
  try {
    await canteenMenuCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ message: "Menu deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Date দিয়ে specific menu দেখো
app.get("/api/canteen/menu/date/:date", async (req, res) => {
  try {
    const menu = await canteenMenuCollection.findOne({ date: req.params.date });
    res.json(menu || { message: "No menu for this date" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

  // ============================================================
  // HALL REP ROUTES
  // ============================================================

  // সব events দেখো
  app.get("/api/events", async (req, res) => {
    try {
      const events = await eventsCollection
        .find()
        .sort({ date: -1 })
        .toArray();
      res.json(events);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Hall Rep event add করবে
  app.post("/api/events", async (req, res) => {
    try {
      const event = { ...req.body, createdAt: new Date() };
      const result = await eventsCollection.insertOne(event);
      res.status(201).json({ message: "Event created", eventId: result.insertedId });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Event update করো
  app.put("/api/events/:id", async (req, res) => {
    try {
      await eventsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { ...req.body, updatedAt: new Date() } }
      );
      res.json({ message: "Event updated" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Event delete করো
  app.delete("/api/events/:id", async (req, res) => {
    try {
      await eventsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.json({ message: "Event deleted" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================================
  // STUDENT PROFILE ROUTE
  // ============================================================

  // Student নিজের profile দেখবে (email দিয়ে)
  // app.get("/api/student/profile/:email", async (req, res) => {
  //   try {
  //     const student = await studentsCollection.findOne({
  //       email: req.params.email,
  //     });
  //     if (!student) return res.status(404).json({ message: "Student not found" });
  //     res.json(student);
  //   } catch (err) {
  //     res.status(500).json({ message: err.message });
  //   }
  // });

  app.get("/api/student/profile/:email", async (req, res) => {
  try {
    // আগে studentsCollection-এ খোঁজো
    let student = await studentsCollection.findOne({ email: req.params.email });

    if (!student) {
      // না পেলে usersCollection থেকে basic info দাও
      const user = await usersCollection.findOne({ email: req.params.email });
      if (!user) return res.status(404).json({ message: "Student not found" });

      // user data দিয়ে একটা partial profile বানাও
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
        _fromUsers: true, // admin এখনো student record add করেনি
      });
    }

    res.json(student);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// Firebase login এর পরে role fetch
app.get("/api/auth/me", async (req, res) => {
  try {
    const { email } = req.query;
    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      subRole: user.subRole,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});




//start of the index.js
  console.log("✅ Routes configured");
}

// Start server first, then initialize database connection
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📡 API URL: http://localhost:${port}`);
  console.log(`📝 Base URL: http://localhost:${port}/api`);
});

// Initialize database connection in background
run().catch(err => {
  console.error("❌ Database initialization error:", err);
});
